/**
 * pdfExporter.js — the two output routes for Interactive Poster Studio.
 *
 *  1. `exportPDF()`  — raster route. The poster is rebuilt offscreen at PPI_BASE, rasterised
 *     with html2canvas at `dpi / PPI_BASE` and wrapped in a single-page jsPDF document whose
 *     page is exactly the poster size in inches.
 *  2. `printPoster()` — vector route. The poster is injected into `#print-root` with an
 *     `@page` rule carrying the real poster size, and the browser's own print engine does the
 *     work. This is the fallback whenever the CDN libraries are unavailable.
 *
 * Both third-party libraries are read off `window` behind guards, so this module loads and the
 * print route keeps working with no network at all.
 */

import { applyAutoFit, buildPoster } from './components/canvas.js';
import { prepareForRaster } from './rasterPrep.js';
import { toast } from './storage.js';

/** CSS pixels per inch at zoom 1 — the ppi the poster is staged at before scaling. */
const PPI_BASE = 96;

/** Hard cap on the rasterised bitmap: width_px * height_px must stay below this. */
const MAX_PIXELS = 100e6;

/** Per-axis cap; browsers refuse to allocate canvases wider/taller than this. */
const MAX_CANVAS_DIM = 16384;

/** Sane DPI floor — below this a poster is unreadable, so we never clamp past it. */
const MIN_DPI = 36;

/** Upper bound accepted from the UI. */
const MAX_DPI = 1200;

/** How long we are willing to wait for webfonts before rasterising anyway. */
const FONT_TIMEOUT_MS = 4000;

/** How long we are willing to wait for all staged <img> elements to settle. */
const IMAGE_TIMEOUT_MS = 9000;

/** Shorter budget for the print route — the browser dialog should not be kept waiting. */
const PRINT_IMAGE_TIMEOUT_MS = 3000;

/** Last-resort cleanup for browsers that never fire `afterprint`. */
const PRINT_CLEANUP_TIMEOUT_MS = 60000;

/** Element ids owned by this module. */
const STAGE_ID = 'pdf-stage';
const PRINT_ROOT_ID = 'print-root';
const PRINT_STYLE_ID = 'print-page-size';

/** Guards against two exports racing over the same offscreen stage. */
let exportInFlight = false;

/** Set while a print run owns `#print-root`; used to make cleanup idempotent. */
let printSession = null;

/* ------------------------------------------------------------------ *
 * Small helpers
 * ------------------------------------------------------------------ */

/**
 * Coerce to a finite number, else fall back.
 * @param {*} v
 * @param {number} fallback
 * @returns {number}
 */
function num(v, fallback) {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return Number.isFinite(n) ? n : fallback;
}

/**
 * @param {number} n @param {number} lo @param {number} hi @returns {number}
 */
function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

/**
 * Filename-safe stem for the poster (no extension). storage.js keeps its own copy of this
 * private to that module, so the rule is duplicated here rather than editing another file.
 * @param {*} name
 * @returns {string}
 */
function safeFileName(name) {
  const base = String(name === null || name === undefined ? '' : name).trim() || 'Untitled_Poster';
  return (
    base
      // Same character class storage.js uses, so a design exports as the same
      // stem in .json, .md and .pdf. Spaces and hyphens are handled below and
      // must not be folded in here, or "Retina-Study" would become "Retina_Study"
      // for the PDF alone.
      .replace(/[\\/:*?"<>|\x00-\x1f]+/g, '_')
      .replace(/\s+/g, '_')
      .replace(/_{2,}/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 120) || 'Untitled_Poster'
  );
}

/**
 * Page size in inches, defensively clamped so a corrupt state cannot produce a 0in page.
 * @param {object} state
 * @returns {{widthIn:number, heightIn:number}}
 */
function pageSizeIn(state) {
  const canvas = (state && state.canvas) || {};
  return {
    widthIn: clamp(num(canvas.widthIn, 48), 1, 400),
    heightIn: clamp(num(canvas.heightIn, 36), 1, 400)
  };
}

/**
 * Invoke a caller-supplied progress callback without ever letting it break the export.
 * @param {Function|undefined} onProgress
 * @param {'preparing'|'rendering'|'encoding'|'saving'|'done'} stage
 * @param {object} [info] extra detail (progress 0..1, message, dpi, …)
 */
function report(onProgress, stage, info = {}) {
  if (typeof onProgress !== 'function') return;
  try {
    onProgress(stage, Object.assign({ stage }, info));
  } catch (err) {
    console.error('exportPDF onProgress callback threw', err);
  }
}

/** Yield to the browser so a progress toast/label can actually paint before we block. */
function nextFrame() {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    } else {
      setTimeout(resolve, 16);
    }
  });
}

/**
 * Resolve when a promise settles or the timeout elapses — never rejects.
 * @param {Promise<*>} promise
 * @param {number} ms
 * @returns {Promise<void>}
 */
function settleWithin(promise, ms) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    const timer = setTimeout(finish, Math.max(0, ms));
    Promise.resolve(promise).then(
      () => {
        clearTimeout(timer);
        finish();
      },
      () => {
        clearTimeout(timer);
        finish();
      }
    );
  });
}

/**
 * Wait for webfonts so text is not rasterised in a fallback face.
 * @returns {Promise<void>}
 */
function waitForFonts() {
  if (typeof document === 'undefined' || !document.fonts || !document.fonts.ready) {
    return Promise.resolve();
  }
  return settleWithin(document.fonts.ready, FONT_TIMEOUT_MS);
}

/**
 * Wait until every <img> inside `root` has loaded or errored. A hanging remote URL can never
 * block the export for longer than `timeoutMs`; images that never settle are simply captured
 * in whatever state they are in (mountImage already renders a placeholder on error).
 *
 * @param {HTMLElement} root
 * @param {number} [timeoutMs]
 * @returns {Promise<void>}
 */
function waitForImages(root, timeoutMs = IMAGE_TIMEOUT_MS) {
  if (!root || typeof root.querySelectorAll !== 'function') return Promise.resolve();
  const imgs = Array.from(root.querySelectorAll('img'));
  const pending = imgs.filter((img) => !(img.complete && (img.naturalWidth > 0 || img.src === '')));
  if (pending.length === 0) return Promise.resolve();

  const waits = pending.map(
    (img) =>
      new Promise((resolve) => {
        const done = () => {
          img.removeEventListener('load', done);
          img.removeEventListener('error', done);
          resolve();
        };
        img.addEventListener('load', done, { once: true });
        img.addEventListener('error', done, { once: true });
      })
  );
  return settleWithin(Promise.all(waits), timeoutMs);
}

/**
 * Resolve the jsPDF constructor from whichever global shape the UMD build installed.
 * @returns {Function|null}
 */
function getJsPDF() {
  if (typeof window === 'undefined') return null;
  const ns = window.jspdf || window.jsPDF;
  if (!ns) return null;
  if (typeof ns === 'function') return ns; // very old builds attach the ctor directly
  if (typeof ns.jsPDF === 'function') return ns.jsPDF;
  if (ns.default && typeof ns.default.jsPDF === 'function') return ns.default.jsPDF;
  return null;
}

/**
 * Work out the DPI we can actually afford, and explain any reduction to the user.
 * @param {number} requestedDpi
 * @param {number} widthIn
 * @param {number} heightIn
 * @returns {{dpi:number, reduced:boolean, message:string}}
 */
function resolveEffectiveDpi(requestedDpi, widthIn, heightIn) {
  const requested = clamp(Math.round(num(requestedDpi, 150)), MIN_DPI, MAX_DPI);
  const area = widthIn * heightIn;

  // Two independent ceilings: total bitmap area, and the per-axis canvas limit.
  // The MIN_DPI floor must stay OUTSIDE this: raising a ceiling up to MIN_DPI
  // would silently defeat the clamp, and the browser would return a blank canvas.
  const byArea = Math.floor(Math.sqrt(MAX_PIXELS / area));
  const byAxis = Math.floor(MAX_CANVAS_DIM / Math.max(widthIn, heightIn));
  const ceiling = Math.min(byArea, byAxis);

  if (ceiling < MIN_DPI) {
    // Even the coarsest raster we are willing to produce exceeds what a canvas
    // can hold. Rasterising at all would fail; the vector route is the answer.
    return {
      dpi: 0,
      reduced: true,
      tooLarge: true,
      message:
        `A ${Math.round(widthIn)} x ${Math.round(heightIn)} in sheet is too large to rasterise ` +
        'in a browser. Use Print / Save as PDF for a full-resolution vector file.'
    };
  }

  if (requested <= ceiling) {
    return { dpi: requested, reduced: false, message: '' };
  }

  const dpi = ceiling;
  const wantedMp = Math.round((area * requested * requested) / 1e6);
  const actualMp = Math.round((area * dpi * dpi) / 1e6);
  const message =
    `${requested} DPI would need ${wantedMp} MP - exporting at ${dpi} DPI ` +
    `(${actualMp} MP). Use Print for a full-resolution vector PDF.`;
  return { dpi, reduced: true, message };
}

/**
 * Create the offscreen staging node. Kept on-screen in the layout sense (html2canvas cannot
 * measure `display:none`) but parked far outside the viewport so the user never sees it.
 * @param {number} widthPx
 * @param {number} heightPx
 * @returns {HTMLElement}
 */
function createStage(widthPx, heightPx) {
  const existing = document.getElementById(STAGE_ID);
  if (existing && existing.parentNode) existing.parentNode.removeChild(existing);

  const stage = document.createElement('div');
  stage.id = STAGE_ID;
  stage.setAttribute('aria-hidden', 'true');
  stage.style.cssText = [
    'position:fixed',
    'left:-100000px',
    'top:0',
    'margin:0',
    'padding:0',
    'border:0',
    'z-index:-1',
    'pointer-events:none',
    'background:#ffffff',
    'overflow:visible',
    'contain:none',
    `width:${widthPx}px`,
    `height:${heightPx}px`
  ].join(';');
  return stage;
}

/* ------------------------------------------------------------------ *
 * Raster route
 * ------------------------------------------------------------------ */

/**
 * Render the poster to a single-page PDF sized exactly like the poster and download it.
 *
 * The poster is rebuilt offscreen at {@link PPI_BASE} and html2canvas is given
 * `scale = effectiveDpi / 96`, so layout maths stay in familiar CSS pixels while the bitmap
 * comes out at the requested print resolution. When the requested DPI would blow past
 * {@link MAX_PIXELS}, the DPI is lowered and the user is told why.
 *
 * @param {object} state full poster state (inches)
 * @param {{dpi?:number, quality?:number, onProgress?:(stage:string, info:object)=>void}} [opts]
 *   `dpi` target print resolution (default 150), `quality` JPEG quality 0..1 (default 0.92;
 *   >= 1 switches to lossless PNG), `onProgress` called as
 *   `(stage, info)` with stage in 'preparing' | 'rendering' | 'encoding' | 'saving' | 'done'.
 * @returns {Promise<boolean>} true when a file was handed to the browser
 */
export async function exportPDF(state, opts = {}) {
  const options = opts && typeof opts === 'object' ? opts : {};
  const onProgress = options.onProgress;
  const quality = clamp(num(options.quality, 0.92), 0.05, 1);

  if (!state || typeof state !== 'object') {
    toast('Nothing to export — the poster state is empty.', 'error', 4200);
    return false;
  }

  if (exportInFlight) {
    toast('A PDF export is already running — please wait for it to finish.', 'warn', 3200);
    return false;
  }

  const html2canvas = typeof window !== 'undefined' ? window.html2canvas : null;
  const JsPDF = getJsPDF();
  if (typeof html2canvas !== 'function' || !JsPDF) {
    const missing = [];
    if (typeof html2canvas !== 'function') missing.push('html2canvas');
    if (!JsPDF) missing.push('jsPDF');
    toast(
      `PDF export needs ${missing.join(' and ')}, which did not load (no network?). ` +
        'Use the Print button instead — it saves a full-quality vector PDF with no libraries.',
      'error',
      7000
    );
    return false;
  }

  const { widthIn, heightIn } = pageSizeIn(state);
  const { dpi, reduced, tooLarge, message } = resolveEffectiveDpi(options.dpi, widthIn, heightIn);

  if (tooLarge) {
    // Bail out before staging anything — html2canvas would return a blank bitmap.
    toast(message, 'error', 8000);
    report(onProgress, 'done', { progress: 1, dpi: 0, message: 'Too large to rasterise' });
    return false;
  }

  const name = safeFileName(state.meta && state.meta.name);

  exportInFlight = true;
  let stage = null;

  try {
    report(onProgress, 'preparing', { progress: 0.05, dpi, message: 'Building the poster…' });
    toast(`Rendering PDF at ${dpi} DPI…`, 'info', 2400);
    if (reduced) toast(message, 'warn', 6500);

    // ---- stage the poster offscreen at the base ppi -------------------------
    const widthPx = Math.max(1, Math.round(widthIn * PPI_BASE));
    const heightPx = Math.max(1, Math.round(heightIn * PPI_BASE));
    stage = createStage(widthPx, heightPx);

    const poster = buildPoster(state, { ppi: PPI_BASE, interactive: false, selectedId: null });
    if (!poster) throw new Error('buildPoster() returned nothing.');
    // Neutralise anything the interactive stage might normally apply.
    poster.style.transform = 'none';
    poster.style.transformOrigin = 'top left';
    poster.style.margin = '0';
    poster.style.boxShadow = 'none';
    stage.appendChild(poster);
    document.body.appendChild(stage);

    report(onProgress, 'preparing', { progress: 0.15, dpi, message: 'Waiting for fonts…' });
    await waitForFonts();
    report(onProgress, 'preparing', { progress: 0.25, dpi, message: 'Waiting for images…' });
    await waitForImages(poster, IMAGE_TIMEOUT_MS);
    await nextFrame();

    // Run after the images have real dimensions, so a figure that pushes on its
    // caption is measured at its final size. Same call the on-screen stage makes,
    // which is what keeps the export identical to the canvas.
    applyAutoFit(poster);

    // Work around html2canvas's missing object-fit support and its broken
    // hyphenation, both of which are visible damage in the finished PDF. Runs
    // after autofit because it needs final box sizes, and preserves every box
    // exactly, so autofit's result is untouched. See rasterPrep.js. The stage is
    // ours alone, so it can be rewritten in place.
    prepareForRaster(poster);

    // ---- rasterise ----------------------------------------------------------
    report(onProgress, 'rendering', {
      progress: 0.35,
      dpi,
      message: `Rasterising ${Math.round(widthIn * dpi)}×${Math.round(heightIn * dpi)} px…`
    });

    const canvas = await html2canvas(poster, {
      scale: dpi / PPI_BASE,
      backgroundColor: '#ffffff',
      useCORS: true,
      allowTaint: false,
      logging: false,
      imageTimeout: IMAGE_TIMEOUT_MS,
      removeContainer: true,
      width: widthPx,
      height: heightPx,
      windowWidth: widthPx,
      windowHeight: heightPx,
      scrollX: 0,
      scrollY: 0
    });
    if (!canvas || !canvas.width || !canvas.height) {
      throw new Error('html2canvas produced an empty bitmap.');
    }

    // ---- encode -------------------------------------------------------------
    report(onProgress, 'encoding', { progress: 0.7, dpi, message: 'Compressing the image…' });
    await nextFrame();

    const usePng = quality >= 1;
    let dataUrl;
    try {
      dataUrl = usePng ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', quality);
    } catch (err) {
      // Practically always a tainted canvas from a cross-origin image without CORS headers.
      throw new Error(
        'The rendered image could not be read back' +
          (err && err.name === 'SecurityError'
            ? ' because a remote image blocked it (CORS). Upload the image instead of linking it, or use Print.'
            : `: ${err && err.message ? err.message : err}`)
      );
    }
    if (!dataUrl || dataUrl.length < 32) throw new Error('The rendered image encoded to nothing.');

    // ---- wrap in a PDF ------------------------------------------------------
    report(onProgress, 'saving', { progress: 0.9, dpi, message: 'Writing the PDF…' });

    const orientation = widthIn >= heightIn ? 'landscape' : 'portrait';
    const doc = new JsPDF({
      unit: 'in',
      format: [widthIn, heightIn],
      orientation,
      compress: true
    });
    doc.addImage(dataUrl, usePng ? 'PNG' : 'JPEG', 0, 0, widthIn, heightIn, undefined, 'FAST');
    if (typeof doc.setProperties === 'function') {
      doc.setProperties({
        title: (state.header && state.header.title) || name,
        author: (state.header && state.header.authors) || '',
        subject: `${widthIn}in × ${heightIn}in poster at ${dpi} DPI`,
        creator: 'Interactive Poster Studio'
      });
    }
    doc.save(`${name}.pdf`);

    report(onProgress, 'done', { progress: 1, dpi, message: 'Saved.' });
    toast(`Saved ${name}.pdf — ${widthIn}×${heightIn} in at ${dpi} DPI.`, 'success', 4200);
    return true;
  } catch (err) {
    console.error('exportPDF failed', err);
    const detail = err && err.message ? err.message : String(err);
    toast(`PDF export failed: ${detail} Try a lower DPI, or use Print.`, 'error', 8000);
    report(onProgress, 'done', { progress: 1, error: detail, message: 'Failed.' });
    return false;
  } finally {
    // The offscreen node must never survive an early return or a throw.
    if (stage && stage.parentNode) stage.parentNode.removeChild(stage);
    const orphan = document.getElementById(STAGE_ID);
    if (orphan && orphan.parentNode) orphan.parentNode.removeChild(orphan);
    exportInFlight = false;
  }
}

/* ------------------------------------------------------------------ *
 * Vector (browser print) route
 * ------------------------------------------------------------------ */

/**
 * Tear down everything printPoster() added. Safe to call any number of times.
 * @param {object} session the session object created by printPoster
 */
function endPrintSession(session) {
  if (!session || session.closed) return;
  session.closed = true;

  if (session.timer) clearTimeout(session.timer);
  if (session.onAfterPrint) window.removeEventListener('afterprint', session.onAfterPrint);
  if (session.mql && session.onMediaChange) {
    if (typeof session.mql.removeEventListener === 'function') {
      session.mql.removeEventListener('change', session.onMediaChange);
    } else if (typeof session.mql.removeListener === 'function') {
      session.mql.removeListener(session.onMediaChange);
    }
  }

  const root = document.getElementById(PRINT_ROOT_ID);
  if (root && root.parentNode) root.parentNode.removeChild(root);
  const style = document.getElementById(PRINT_STYLE_ID);
  if (style && style.parentNode) style.parentNode.removeChild(style);
  document.body.classList.remove('printing');

  if (printSession === session) printSession = null;
}

/**
 * Vector route: hand the real poster to the browser's print engine with an `@page` rule that
 * matches the poster size, so "Save as PDF" yields crisp, selectable, full-resolution output
 * with no third-party library involved.
 *
 * Everything injected (`#print-page-size`, `#print-root`, `body.printing`) is removed again on
 * `afterprint`, on leaving the print media state, or by a safety timer for the browsers that
 * fire neither.
 *
 * @param {object} state full poster state (inches)
 * @returns {boolean} true when the print run was started
 */
export function printPoster(state) {
  if (!state || typeof state !== 'object') {
    toast('Nothing to print — the poster state is empty.', 'error', 4200);
    return false;
  }
  if (typeof window === 'undefined' || typeof window.print !== 'function') {
    toast('This browser does not support printing from a script.', 'error', 4200);
    return false;
  }
  if (printSession) {
    // A stale session (dialog dismissed without any event) must not block a retry.
    endPrintSession(printSession);
  }

  const { widthIn, heightIn } = pageSizeIn(state);
  const session = { closed: false, timer: null, onAfterPrint: null, mql: null, onMediaChange: null };
  printSession = session;

  try {
    // Drop anything a previous run may have left behind.
    const staleRoot = document.getElementById(PRINT_ROOT_ID);
    if (staleRoot && staleRoot.parentNode) staleRoot.parentNode.removeChild(staleRoot);
    const staleStyle = document.getElementById(PRINT_STYLE_ID);
    if (staleStyle && staleStyle.parentNode) staleStyle.parentNode.removeChild(staleStyle);

    const style = document.createElement('style');
    style.id = PRINT_STYLE_ID;
    style.textContent = `@page { size: ${widthIn}in ${heightIn}in; margin: 0; }`;
    document.head.appendChild(style);

    const root = document.createElement('div');
    root.id = PRINT_ROOT_ID;
    const poster = buildPoster(state, { ppi: PPI_BASE, interactive: false, selectedId: null });
    if (!poster) throw new Error('buildPoster() returned nothing.');
    poster.style.transform = 'none';
    poster.style.transformOrigin = 'top left';
    poster.style.margin = '0';
    poster.style.boxShadow = 'none';
    root.appendChild(poster);
    document.body.appendChild(root);
    document.body.classList.add('printing');

    session.onAfterPrint = () => endPrintSession(session);
    window.addEventListener('afterprint', session.onAfterPrint);

    // Safari historically fires only the media-query transition, not `afterprint`.
    if (typeof window.matchMedia === 'function') {
      session.mql = window.matchMedia('print');
      session.onMediaChange = (e) => {
        if (!e.matches) endPrintSession(session);
      };
      if (typeof session.mql.addEventListener === 'function') {
        session.mql.addEventListener('change', session.onMediaChange);
      } else if (typeof session.mql.addListener === 'function') {
        session.mql.addListener(session.onMediaChange);
      }
    }

    // Last resort for browsers that fire neither event: never leave the app stuck in
    // print mode, but wait long enough that a slow user is not cut off mid-dialog.
    session.timer = setTimeout(() => endPrintSession(session), PRINT_CLEANUP_TIMEOUT_MS);

    toast(`Preparing a ${widthIn}×${heightIn} in vector PDF — choose "Save as PDF".`, 'info', 4200);

    // Give fonts and images a bounded chance to settle, then open the dialog.
    Promise.resolve()
      .then(() => settleWithin(waitForFonts(), FONT_TIMEOUT_MS))
      .then(() => waitForImages(poster, PRINT_IMAGE_TIMEOUT_MS))
      .then(() => nextFrame())
      .then(() => {
        if (session.closed) return;
        applyAutoFit(poster);
        window.print();
        // Chrome/Firefox block here until the dialog closes and then fire `afterprint`;
        // browsers that return immediately are covered by the listeners above.
      })
      .catch((err) => {
        console.error('printPoster failed while opening the dialog', err);
        toast('Could not open the print dialog. Use your browser menu › Print.', 'error', 5200);
        endPrintSession(session);
      });

    return true;
  } catch (err) {
    console.error('printPoster failed', err);
    endPrintSession(session);
    toast(
      `Could not prepare the print view: ${err && err.message ? err.message : err}`,
      'error',
      5200
    );
    return false;
  }
}
