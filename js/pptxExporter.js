/**
 * pptxExporter.js — export the poster as a single PowerPoint slide.
 *
 * ## Why this reads the DOM instead of the state
 *
 * The poster's geometry is the product of flexbox: ratios, gaps, remainder
 * columns and auto-fit type all resolve at layout time, and no amount of
 * arithmetic over `posterState` reproduces them faithfully. So this module does
 * what the PDF exporter does — stages the poster offscreen at {@link PPI_BASE}
 * through the one `buildPoster()` path — and then *measures* the result. Every
 * `getBoundingClientRect()` divided by 96 is an exact inch position, which is
 * precisely the coordinate system PowerPoint wants.
 *
 * ## Native first, raster only where it must be
 *
 * The point of a .pptx (over the .pdf we already emit) is that the recipient can
 * edit it, so anything that maps cleanly onto PowerPoint primitives is emitted
 * as one:
 *
 *   block card      -> a rectangle shape with the block's fill, border, radius
 *   heading/body    -> a text box of real runs (bold/italic/links/bullets)
 *   section header  -> a filled rectangle + a text box
 *   figure          -> a picture, plus a text box for its caption
 *
 * Four things have no honest PowerPoint equivalent — KaTeX maths, Markdown
 * tables, inline images inside prose, and inline SVG. A block containing any of
 * them is rasterised as a single picture, and only that block. See
 * {@link needsRaster}.
 *
 * pptxgenjs is read off `window` behind a guard, exactly like jsPDF: this module
 * loads and the rest of the app works with no network at all.
 */

import { applyAutoFit, buildPoster } from './components/canvas.js';
import { applyRasterMarks, markForRaster } from './rasterPrep.js';
import { toast } from './storage.js';

/** CSS pixels per inch at zoom 1 — the ppi the poster is staged at. */
const PPI_BASE = 96;

/** CSS px -> points, the unit PowerPoint sizes text in. */
const PX_TO_PT = 72 / PPI_BASE;

/**
 * PowerPoint refuses slides larger than 56 inches on either axis. A 48×36 in
 * poster is fine; the 8-foot boards some conferences use are not, so those are
 * scaled down as a whole and the user is told the slide is a scale model.
 */
const MAX_SLIDE_IN = 56;

/** Supersampling for the blocks we have to rasterise (2 = ~192 dpi). */
const RASTER_SCALE = 2;

/** Waits, mirroring pdfExporter so both routes behave the same under a slow CDN. */
const FONT_TIMEOUT_MS = 4000;
const IMAGE_TIMEOUT_MS = 9000;

/** Element id owned by this module. */
const STAGE_ID = 'pptx-stage';

/** Guards against two exports racing over the same offscreen stage. */
let exportInFlight = false;

/* ------------------------------------------------------------------ *
 * Small helpers
 * ------------------------------------------------------------------ */

function num(v, fallback) {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return Number.isFinite(n) ? n : fallback;
}

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

/**
 * Filename-safe stem. Deliberately the same rule as storage.js and
 * pdfExporter.js so one design exports as one stem across .json/.md/.pdf/.pptx.
 */
function safeFileName(name) {
  const base = String(name === null || name === undefined ? '' : name).trim() || 'Untitled_Poster';
  return (
    base
      .replace(/[\\/:*?"<>|\x00-\x1f]+/g, '_')
      .replace(/\s+/g, '_')
      .replace(/_{2,}/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 120) || 'Untitled_Poster'
  );
}

function nextFrame() {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    } else {
      setTimeout(resolve, 16);
    }
  });
}

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
      () => { clearTimeout(timer); finish(); },
      () => { clearTimeout(timer); finish(); }
    );
  });
}

function waitForFonts() {
  if (typeof document === 'undefined' || !document.fonts || !document.fonts.ready) {
    return Promise.resolve();
  }
  return settleWithin(document.fonts.ready, FONT_TIMEOUT_MS);
}

function waitForImages(root, timeoutMs = IMAGE_TIMEOUT_MS) {
  if (!root || typeof root.querySelectorAll !== 'function') return Promise.resolve();
  const imgs = Array.from(root.querySelectorAll('img'));
  const pending = imgs.filter((img) => !(img.complete && (img.naturalWidth > 0 || img.src === '')));
  if (pending.length === 0) return Promise.resolve();
  const waits = pending.map((img) => new Promise((resolve) => {
    const done = () => {
      img.removeEventListener('load', done);
      img.removeEventListener('error', done);
      resolve();
    };
    img.addEventListener('load', done, { once: true });
    img.addEventListener('error', done, { once: true });
  }));
  return settleWithin(Promise.all(waits), timeoutMs);
}

/** Resolve the PptxGenJS constructor from whichever global shape the bundle installed. */
function getPptxGenJS() {
  if (typeof window === 'undefined') return null;
  const ns = window.PptxGenJS || window.pptxgen || window.pptxgenjs;
  if (!ns) return null;
  if (typeof ns === 'function') return ns;
  if (typeof ns.default === 'function') return ns.default;
  return null;
}

/* ------------------------------------------------------------------ *
 * Colour + geometry
 * ------------------------------------------------------------------ */

/**
 * CSS colour -> `{ hex: 'RRGGBB', alpha: 0..1 }`. pptxgenjs wants bare hex with
 * no leading `#`, and expresses opacity separately as a 0-100 transparency.
 *
 * @param {string} value any computed colour string
 * @param {string} [fallback='000000']
 * @returns {{hex:string, alpha:number}}
 */
function parseColor(value, fallback = '000000') {
  const str = String(value || '').trim();
  if (!str) return { hex: fallback, alpha: 1 };

  const rgb = str.match(/^rgba?\(([^)]+)\)$/i);
  if (rgb) {
    const parts = rgb[1].split(/[\s,/]+/).filter(Boolean);
    const to255 = (p) => (p.endsWith('%') ? Math.round((parseFloat(p) / 100) * 255) : Math.round(parseFloat(p)));
    const r = clamp(to255(parts[0] || '0'), 0, 255);
    const g = clamp(to255(parts[1] || '0'), 0, 255);
    const b = clamp(to255(parts[2] || '0'), 0, 255);
    const a = parts.length > 3 ? clamp(parseFloat(parts[3]), 0, 1) : 1;
    return { hex: toHex(r, g, b), alpha: Number.isFinite(a) ? a : 1 };
  }

  const hex = str.match(/^#([0-9a-f]{3,8})$/i);
  if (hex) {
    let h = hex[1];
    if (h.length === 3 || h.length === 4) h = h.split('').map((c) => c + c).join('');
    const alpha = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
    return { hex: h.slice(0, 6).toUpperCase(), alpha };
  }

  // Named colours and anything exotic: let the browser normalise it for us.
  if (typeof document !== 'undefined') {
    const probe = document.createElement('span');
    probe.style.color = str;
    if (probe.style.color) {
      const el = document.createElement('span');
      el.style.cssText = `position:absolute;left:-9999px;color:${str}`;
      document.body.appendChild(el);
      const computed = getComputedStyle(el).color;
      document.body.removeChild(el);
      if (computed && computed !== str) return parseColor(computed, fallback);
    }
  }
  return { hex: fallback, alpha: 1 };
}

function toHex(r, g, b) {
  return [r, g, b].map((n) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0')).join('').toUpperCase();
}

/** True when a computed colour is fully transparent and so should not be drawn. */
function isTransparent(value) {
  const str = String(value || '').trim().toLowerCase();
  if (!str || str === 'transparent' || str === 'none') return true;
  return parseColor(str).alpha === 0;
}

/**
 * An element's box as slide inches, relative to the poster's top-left.
 * @param {Element} el
 * @param {DOMRect} origin the poster root's rect
 * @param {number} scale slide-shrink factor (1 unless the poster exceeds 56 in)
 */
function rectOf(el, origin, scale) {
  const r = el.getBoundingClientRect();
  return {
    x: ((r.left - origin.left) / PPI_BASE) * scale,
    y: ((r.top - origin.top) / PPI_BASE) * scale,
    w: (r.width / PPI_BASE) * scale,
    h: (r.height / PPI_BASE) * scale
  };
}

/** Computed font-size of an element, in PowerPoint points. */
function fontPt(el, scale) {
  const px = parseFloat(getComputedStyle(el).fontSize) || 16;
  return Math.max(1, Math.round(px * PX_TO_PT * scale * 10) / 10);
}

/** Map a CSS text-align onto the three PowerPoint understands. */
function alignOf(el) {
  const value = getComputedStyle(el).textAlign;
  if (value === 'center') return 'center';
  if (value === 'right' || value === 'end') return 'right';
  return 'left'; // 'justify' has no PowerPoint text-box equivalent
}

/** The first family in a CSS font stack, unquoted — what PowerPoint expects. */
function fontFaceOf(el) {
  const stack = getComputedStyle(el).fontFamily || '';
  const first = stack.split(',')[0] || '';
  return first.replace(/["']/g, '').trim() || 'Arial';
}

/* ------------------------------------------------------------------ *
 * Rendered prose -> PowerPoint text runs
 * ------------------------------------------------------------------ */

/** Tags whose content cannot survive the trip as text, so the block is rasterised instead. */
const RASTER_SELECTOR = '.katex, .katex-display, table, img, svg, canvas';

/**
 * Should this subtree be shipped as a picture rather than as text?
 * @param {Element} el
 * @returns {boolean}
 */
function needsRaster(el) {
  return !!(el && el.querySelector && el.querySelector(RASTER_SELECTOR));
}

/** Block-level tags that start a new paragraph in the output. */
const BLOCK_TAGS = new Set([
  'P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI',
  'BLOCKQUOTE', 'PRE', 'DL', 'DT', 'DD', 'FIGCAPTION', 'HR'
]);

/**
 * Convert one rendered `.prose` subtree into pptxgenjs text objects.
 *
 * Formatting is taken from the *computed* styles rather than re-derived from the
 * Markdown source, so per-block overrides, the global theme and auto-fit
 * shrinking all carry through to the slide without being reimplemented here.
 *
 * @param {Element} root the `.prose` element (or any container of paragraphs)
 * @param {number} scale slide-shrink factor
 * @returns {Array<{text:string, options:object}>} runs, ready for `addText`
 */
function proseToRuns(root, scale) {
  /** @type {Array<{text:string, options:object}>} */
  const runs = [];
  if (!root) return runs;

  const walkBlock = (el, depth, listType) => {
    const tag = el.tagName;

    if (tag === 'HR') {
      runs.push({ text: '———', options: { breakLine: true, fontSize: fontPt(el, scale) } });
      return;
    }

    if (tag === 'UL' || tag === 'OL') {
      for (const child of el.children) walkBlock(child, depth, tag === 'OL' ? 'number' : 'bullet');
      return;
    }

    // A list item may hold nested lists; emit its own text first, then recurse.
    // The nested lists are skipped in place rather than copied into a detached
    // host: `getComputedStyle()` returns nothing for an unparented element, so
    // walking clones would throw away every measured size — including the
    // per-block pt override and the `.ps-pt` spans the hover menu writes — and
    // silently flatten the whole slide to the 16px default.
    const nested = [];
    for (const child of el.childNodes) {
      if (child.nodeType === 1 && (child.tagName === 'UL' || child.tagName === 'OL')) nested.push(child);
    }

    const before = runs.length;
    collectInline(el, baseStyleOf(el, scale), runs, new Set(nested));
    trimRuns(runs, before);

    if (runs.length > before) {
      const first = runs[before];
      if (listType) {
        first.options.bullet = listType === 'number' ? { type: 'number' } : true;
        first.options.indentLevel = depth;
      } else if (depth > 0) {
        first.options.indentLevel = depth;
      }
      runs[runs.length - 1].options.breakLine = true;
    }

    for (const list of nested) walkBlock(list, depth + 1, list.tagName === 'OL' ? 'number' : 'bullet');
  };

  const children = Array.from(root.children);
  if (children.length === 0) {
    collectInline(root, baseStyleOf(root, scale), runs);
    trimRuns(runs, 0);
  } else {
    for (const child of children) {
      if (BLOCK_TAGS.has(child.tagName)) walkBlock(child, 0, null);
      else collectInline(child, baseStyleOf(root, scale), runs);
    }
  }

  // A trailing break would add an empty line inside the text box.
  if (runs.length) delete runs[runs.length - 1].options.breakLine;
  return runs;
}

/**
 * Run options implied by an element's own computed style.
 *
 * `__scale` rides along so the recursive walk keeps measuring in the same unit
 * system; it is stripped again by {@link cleanRuns} before the runs reach
 * pptxgenjs. Without it every nested `<strong>` or `.ps-pt` span on an
 * oversized poster would be re-measured at scale 1 and come out too large.
 */
function baseStyleOf(el, scale) {
  const cs = getComputedStyle(el);
  return {
    fontSize: fontPt(el, scale),
    fontFace: fontFaceOf(el),
    color: parseColor(cs.color, '000000').hex,
    bold: fontWeightOf(cs) >= 600,
    italic: cs.fontStyle === 'italic' || cs.fontStyle === 'oblique',
    __scale: scale
  };
}

function fontWeightOf(cs) {
  const w = cs.fontWeight;
  if (w === 'bold' || w === 'bolder') return 700;
  const n = Number(w);
  return Number.isFinite(n) ? n : 400;
}

/**
 * Depth-first walk of inline content, pushing one run per contiguous run of
 * identically-styled text.
 *
 * @param {Node} node
 * @param {object} inherited run options in force at this point
 * @param {Array} out
 * @param {Set<Node>} [skip] subtrees the caller emits separately (nested lists)
 */
function collectInline(node, inherited, out, skip) {
  if (!node) return;
  if (skip && skip.has(node)) return;

  if (node.nodeType === 3) {
    // Collapse whitespace the way the browser already did visually.
    const text = node.nodeValue.replace(/\s+/g, ' ');
    if (!text) return;
    out.push({ text, options: { ...inherited } });
    return;
  }
  if (node.nodeType !== 1) return;

  const tag = node.tagName;
  if (tag === 'BR') {
    if (out.length) out[out.length - 1].options.breakLine = true;
    return;
  }

  // baseStyleOf re-measures this element, which is how a `.ps-pt` span or an
  // `<h2>` inside the prose picks up its own size instead of the parent's.
  const style = { ...inherited, ...baseStyleOf(node, inherited.__scale || 1) };

  if (tag === 'STRONG' || tag === 'B') style.bold = true;
  if (tag === 'EM' || tag === 'I') style.italic = true;
  if (tag === 'U' || tag === 'INS') style.underline = { style: 'sng' };
  if (tag === 'S' || tag === 'DEL') style.strike = true;
  if (tag === 'SUP') style.superscript = true;
  if (tag === 'SUB') style.subscript = true;
  if (tag === 'CODE' || tag === 'KBD' || tag === 'SAMP' || tag === 'PRE') style.fontFace = 'Consolas';
  if (tag === 'A') {
    const href = node.getAttribute('href');
    if (href) style.hyperlink = { url: href };
  }

  for (const child of node.childNodes) collectInline(child, style, out, skip);
}

/** Drop leading/trailing whitespace-only runs added from index `from` onward. */
function trimRuns(runs, from) {
  while (runs.length > from && !runs[from].text.trim()) runs.splice(from, 1);
  while (runs.length > from && !runs[runs.length - 1].text.trim()) runs.pop();
  if (runs.length > from) {
    runs[from].text = runs[from].text.replace(/^\s+/, '');
    runs[runs.length - 1].text = runs[runs.length - 1].text.replace(/\s+$/, '');
  }
}

/** Strip the private bookkeeping key before the runs reach pptxgenjs. */
function cleanRuns(runs) {
  for (const run of runs) delete run.options.__scale;
  return runs.filter((run) => run.text !== '');
}

/* ------------------------------------------------------------------ *
 * Pictures
 * ------------------------------------------------------------------ */

/**
 * A data URI for an already-loaded `<img>`, in the `mime;base64,…` shape
 * pptxgenjs wants (note: no `data:` prefix).
 *
 * Returns null when the pixels cannot be read — a cross-origin image without
 * CORS headers taints the canvas, and there is no way around that from script.
 *
 * @param {HTMLImageElement} img
 * @returns {string|null}
 */
function imageToPptxData(img) {
  if (!img) return null;

  const src = img.currentSrc || img.src || '';
  if (src.startsWith('data:')) return src.slice('data:'.length);

  if (!img.complete || !img.naturalWidth) return null;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0);
    return canvas.toDataURL('image/png').slice('data:'.length);
  } catch (_err) {
    return null; // tainted canvas
  }
}

/**
 * Rasterise one element to a data URI via html2canvas.
 * @param {Element} el
 * @returns {Promise<string|null>} `mime;base64,…` or null when unavailable
 */
async function rasterise(el) {
  const html2canvas = typeof window !== 'undefined' ? window.html2canvas : null;
  if (typeof html2canvas !== 'function' || !el) return null;
  // `el` is live on screen, so it must not be mutated: measure here, where the
  // images are decoded, and let onclone rewrite the throwaway copy. See rasterPrep.js.
  const unmark = markForRaster(el);
  try {
    const canvas = await html2canvas(el, {
      scale: RASTER_SCALE,
      backgroundColor: null,
      useCORS: true,
      allowTaint: false,
      logging: false,
      imageTimeout: IMAGE_TIMEOUT_MS,
      removeContainer: true,
      onclone: applyRasterMarks
    });
    if (!canvas || !canvas.width || !canvas.height) return null;
    return canvas.toDataURL('image/png').slice('data:'.length);
  } catch (err) {
    console.warn('PPTX export could not rasterise a block', err);
    return null;
  } finally {
    unmark();
  }
}

/* ------------------------------------------------------------------ *
 * Slide assembly
 * ------------------------------------------------------------------ */

/** Add a filled/bordered rectangle matching an element's card styling. */
function addCard(pptx, slide, el, box) {
  const cs = getComputedStyle(el);
  const opacity = clamp(num(parseFloat(cs.opacity), 1), 0, 1);
  const fill = parseColor(cs.backgroundColor, 'FFFFFF');
  const hasFill = !isTransparent(cs.backgroundColor);

  const borderPx = parseFloat(cs.borderTopWidth) || 0;
  const hasBorder = borderPx > 0 && cs.borderTopStyle !== 'none' && !isTransparent(cs.borderTopColor);

  if (!hasFill && !hasBorder) return;

  const radiusPx = parseFloat(cs.borderTopLeftRadius) || 0;
  const minSideIn = Math.max(0.01, Math.min(box.w, box.h));
  // pptxgenjs takes rectRadius as a 0..1 fraction of the shorter side.
  const radius = clamp((radiusPx / PPI_BASE) / minSideIn, 0, 0.5);
  const shape = radius > 0.01 ? pptx.ShapeType.roundRect : pptx.ShapeType.rect;

  const options = { x: box.x, y: box.y, w: box.w, h: box.h };
  if (shape === pptx.ShapeType.roundRect) options.rectRadius = radius;
  options.fill = hasFill
    ? { color: fill.hex, transparency: Math.round((1 - fill.alpha * opacity) * 100) }
    : { type: 'none' };
  if (hasBorder) {
    const line = parseColor(cs.borderTopColor, '000000');
    options.line = { color: line.hex, width: Math.max(0.25, borderPx * PX_TO_PT) };
  } else {
    options.line = { type: 'none' };
  }

  slide.addShape(shape, options);
}

/**
 * Add a text box for an element, as native runs when we can and as a picture
 * when the content needs one.
 *
 * @returns {Promise<void>}
 */
async function addTextBox(slide, el, box, scale, extra = {}) {
  if (!el) return;

  if (needsRaster(el)) {
    const data = await rasterise(el);
    if (data) {
      slide.addImage({ data, x: box.x, y: box.y, w: box.w, h: box.h, altText: el.textContent.slice(0, 200) });
      return;
    }
    // No html2canvas: plain text is a poorer but honest fallback.
  }

  const runs = cleanRuns(proseToRuns(el, scale));
  if (!runs.length) return;

  slide.addText(runs, {
    x: box.x,
    y: box.y,
    w: box.w,
    h: box.h,
    align: alignOf(el),
    valign: 'top',
    margin: 0,
    wrap: true,
    // The canvas already shrank the text to fit; asking PowerPoint to shrink it
    // again is what keeps the slide honest when a recipient edits the wording.
    fit: 'shrink',
    ...extra
  });
}

/** The header band: its fill, the two logos and the three text fields. */
async function addHeader(pptx, slide, poster, origin, scale) {
  const band = poster.querySelector('.poster-header');
  if (!band) return;

  const box = rectOf(band, origin, scale);
  addCard(pptx, slide, band, box);

  for (const logo of band.querySelectorAll('.poster-header__logo img')) {
    const data = imageToPptxData(logo);
    if (!data) continue;
    const lbox = rectOf(logo, origin, scale);
    slide.addImage({
      data,
      x: lbox.x, y: lbox.y, w: lbox.w, h: lbox.h,
      sizing: { type: 'contain', w: lbox.w, h: lbox.h },
      altText: logo.alt || 'Logo'
    });
  }

  for (const selector of ['.poster-title', '.poster-authors', '.poster-affiliations']) {
    const field = band.querySelector(selector);
    if (!field || !field.textContent.trim()) continue;
    await addTextBox(slide, field, rectOf(field, origin, scale), scale, {
      valign: selector === '.poster-title' ? 'bottom' : 'top'
    });
  }
}

/** One leaf block: its card, then whichever content it holds. */
async function addLeaf(pptx, slide, el, origin, scale) {
  const box = rectOf(el, origin, scale);
  addCard(pptx, slide, el, box);

  const type = el.dataset.type;

  if (type === 'section') {
    const banner = el.querySelector('.block__section-text');
    if (banner) {
      await addTextBox(slide, banner, rectOf(banner, origin, scale), scale, { valign: 'middle' });
    }
    return;
  }

  const title = el.querySelector('.block__title');
  if (title && title.textContent.trim()) {
    await addTextBox(slide, title, rectOf(title, origin, scale), scale);
  }

  if (type === 'image') {
    const media = el.querySelector('.block__figure-media');
    const img = el.querySelector('.block__figure-media img');
    const data = imageToPptxData(img);
    if (media && data) {
      const mbox = rectOf(media, origin, scale);
      const fit = img && getComputedStyle(img).objectFit === 'cover' ? 'cover' : 'contain';
      slide.addImage({
        data,
        x: mbox.x, y: mbox.y, w: mbox.w, h: mbox.h,
        sizing: { type: fit, w: mbox.w, h: mbox.h },
        altText: (img && img.alt) || 'Figure'
      });
    } else if (media) {
      // Missing or unreadable image: keep the placeholder the canvas drew, so
      // the slide shows the same "no image" state rather than a silent gap.
      const data2 = await rasterise(media);
      if (data2) {
        const mbox = rectOf(media, origin, scale);
        slide.addImage({ data: data2, x: mbox.x, y: mbox.y, w: mbox.w, h: mbox.h, altText: 'Missing image' });
      }
    }

    const caption = el.querySelector('.block__caption');
    if (caption && caption.textContent.trim()) {
      await addTextBox(slide, caption, rectOf(caption, origin, scale), scale);
    }
    return;
  }

  const body = el.querySelector('.block__body');
  const prose = (body && body.querySelector('.prose')) || body;
  if (prose && prose.textContent.trim()) {
    await addTextBox(slide, prose, rectOf(prose, origin, scale), scale);
  }
}

/* ------------------------------------------------------------------ *
 * Offscreen stage
 * ------------------------------------------------------------------ */

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
 * Public entry point
 * ------------------------------------------------------------------ */

/**
 * Export the poster as a one-slide `.pptx` and hand it to the browser.
 *
 * @param {object} state full poster state (inches)
 * @param {{onProgress?:(stage:string, info:object)=>void}} [opts]
 *   `onProgress` is called with 'preparing' | 'building' | 'saving' | 'done'.
 * @returns {Promise<boolean>} true when a file was downloaded
 */
export async function exportPPTX(state, opts = {}) {
  const options = opts && typeof opts === 'object' ? opts : {};
  const report = (stage, info = {}) => {
    if (typeof options.onProgress !== 'function') return;
    try {
      options.onProgress(stage, Object.assign({ stage }, info));
    } catch (err) {
      console.error('exportPPTX onProgress callback threw', err);
    }
  };

  if (!state || typeof state !== 'object') {
    toast('Nothing to export — the poster state is empty.', 'error', 4200);
    return false;
  }
  if (exportInFlight) {
    toast('A PowerPoint export is already running — please wait for it to finish.', 'warn', 3200);
    return false;
  }

  const PptxGenJS = getPptxGenJS();
  if (!PptxGenJS) {
    toast(
      'PowerPoint export needs the pptxgenjs library, which did not load (no network?). ' +
        'Export PDF or Print instead — neither needs it.',
      'error',
      7000
    );
    return false;
  }

  const canvas = state.canvas || {};
  const widthIn = clamp(num(canvas.widthIn, 48), 1, 400);
  const heightIn = clamp(num(canvas.heightIn, 36), 1, 400);
  const scale = Math.min(1, MAX_SLIDE_IN / Math.max(widthIn, heightIn));
  const name = safeFileName(state.meta && state.meta.name);

  exportInFlight = true;
  let stage = null;

  try {
    report('preparing', { progress: 0.05, message: 'Building the poster…' });
    toast('Building the PowerPoint slide…', 'info', 2400);
    if (scale < 1) {
      toast(
        `PowerPoint slides stop at ${MAX_SLIDE_IN} in, so this ${Math.round(widthIn)}×${Math.round(heightIn)} in ` +
          `poster is exported at ${Math.round(scale * 100)}% — a scale model with every proportion intact. ` +
          'Use Export PDF for the full-size sheet.',
        'warn',
        7500
      );
    }

    const widthPx = Math.max(1, Math.round(widthIn * PPI_BASE));
    const heightPx = Math.max(1, Math.round(heightIn * PPI_BASE));
    stage = createStage(widthPx, heightPx);

    const poster = buildPoster(state, { ppi: PPI_BASE, interactive: false, selectedId: null });
    if (!poster) throw new Error('buildPoster() returned nothing.');
    poster.style.transform = 'none';
    poster.style.margin = '0';
    poster.style.boxShadow = 'none';
    stage.appendChild(poster);
    document.body.appendChild(stage);

    report('preparing', { progress: 0.15, message: 'Waiting for fonts…' });
    await waitForFonts();
    report('preparing', { progress: 0.25, message: 'Waiting for images…' });
    await waitForImages(poster, IMAGE_TIMEOUT_MS);
    await nextFrame();
    // Measure only what the reader would actually see: same auto-fit pass the
    // on-screen canvas and the PDF route run.
    applyAutoFit(poster);

    report('building', { progress: 0.4, message: 'Laying out the slide…' });

    const pptx = new PptxGenJS();
    pptx.defineLayout({ name: 'POSTER', width: widthIn * scale, height: heightIn * scale });
    pptx.layout = 'POSTER';
    pptx.author = (state.header && state.header.authors) || 'Interactive Poster Studio';
    pptx.company = 'Interactive Poster Studio';
    pptx.title = (state.header && state.header.title) || name;

    const slide = pptx.addSlide();

    const origin = poster.getBoundingClientRect();
    const posterStyle = getComputedStyle(poster);
    slide.background = { color: parseColor(posterStyle.backgroundColor, 'FFFFFF').hex };

    // A background image is a single full-bleed picture behind everything else.
    const bgLayer = poster.querySelector('.poster__bg');
    if (bgLayer) {
      const bgImg = bgLayer.querySelector('img');
      const data = bgImg ? imageToPptxData(bgImg) : await rasterise(bgLayer);
      if (data) {
        const cs = getComputedStyle(bgLayer);
        slide.addImage({
          data,
          x: 0, y: 0, w: widthIn * scale, h: heightIn * scale,
          sizing: { type: 'cover', w: widthIn * scale, h: heightIn * scale },
          transparency: Math.round((1 - clamp(num(parseFloat(cs.opacity), 1), 0, 1)) * 100),
          altText: 'Poster background'
        });
      }
    }

    await addHeader(pptx, slide, poster, origin, scale);

    // Leaves only: a split contributes nothing visible of its own, and drawing
    // its box would put an opaque rectangle over its children.
    const leaves = poster.querySelectorAll('.poster__body .block[data-kind="leaf"]');
    let index = 0;
    for (const leaf of leaves) {
      await addLeaf(pptx, slide, leaf, origin, scale);
      index += 1;
      report('building', {
        progress: 0.4 + (0.5 * index) / Math.max(1, leaves.length),
        message: `Block ${index} of ${leaves.length}…`
      });
    }

    slide.addNotes(
      `${(state.header && state.header.title) || name}\n` +
        `${widthIn} x ${heightIn} in poster exported from Interactive Poster Studio` +
        (scale < 1 ? ` at ${Math.round(scale * 100)}% scale.` : '.') +
        '\nText boxes and shapes are editable; blocks containing maths, tables or inline ' +
        'images were placed as pictures.'
    );

    report('saving', { progress: 0.95, message: 'Writing the file…' });
    await pptx.writeFile({ fileName: `${name}.pptx` });

    report('done', { progress: 1, message: 'Saved.' });
    toast(`Saved ${name}.pptx — one editable slide, ${leaves.length} blocks.`, 'success', 4200);
    return true;
  } catch (err) {
    console.error('exportPPTX failed', err);
    const detail = err && err.message ? err.message : String(err);
    toast(`PowerPoint export failed: ${detail}`, 'error', 8000);
    report('done', { progress: 1, error: detail, message: 'Failed.' });
    return false;
  } finally {
    if (stage && stage.parentNode) stage.parentNode.removeChild(stage);
    const orphan = document.getElementById(STAGE_ID);
    if (orphan && orphan.parentNode) orphan.parentNode.removeChild(orphan);
    exportInFlight = false;
  }
}
