/**
 * rasterPrep.js — make a poster subtree safe to hand to html2canvas.
 *
 * Why this module exists
 * ----------------------
 * html2canvas 1.4.1 is not a browser. Two of its gaps show up as visible damage
 * in the raster PDF/PPTX routes, and both are fixed here by rewriting the tree
 * into a shape whose *correct* rendering html2canvas can already produce.
 *
 *  1. **`object-fit` is not implemented at all.** Its replaced-element painter is
 *     literally
 *         ctx.drawImage(img, 0, 0, intrinsicW, intrinsicH, box.left, box.top, box.width, box.height)
 *     — the whole source image stretched into the whole content box, with no
 *     aspect-ratio preservation. Every `contain` / `cover` image in the poster
 *     therefore comes out squashed. Measured on the stock poster: a 640x400
 *     figure in a 993x417 box is skewed 1.49x, and a tall logo can skew 3.7x.
 *     Fix: compute the geometry the browser *would* have drawn, wrap the image
 *     in a clipping frame of the original box size, position the image inside it
 *     at that exact geometry, and set `object-fit: fill` so html2canvas's stretch
 *     becomes a no-op. `background-size` IS supported, so the poster's
 *     background layer needs nothing.
 *
 *  2. **Automatic hyphenation breaks apart.** html2canvas splits the word at the
 *     same place the browser did but never paints the hyphen glyph, and offsets
 *     the continuation — "screening ser-/vices" comes out as "screening serv /
 *     ices" with a stray indent. Fix: switch `hyphens: auto` to `manual` for the
 *     raster pass so lines break at word boundaries instead.
 *
 * Neither change is wanted on screen or in the *print* route — the browser gets
 * both right there — so nothing here runs unless a rasteriser is about to.
 *
 * Two entry points, because the two callers own different trees:
 *
 *   - {@link prepareForRaster} mutates the node in place. Use it when the node is
 *     a throwaway offscreen clone (the PDF stage), where mutation is free.
 *   - {@link markForRaster} + `onclone: applyRasterMarks` for a *live* on-screen
 *     node. Measurement happens on the live tree — where images are decoded and
 *     `naturalWidth` is trustworthy — and only the resulting numbers cross into
 *     html2canvas's clone, which is not guaranteed to have loaded anything yet.
 */

/** Attribute carrying measured geometry across into an html2canvas clone. */
const FIT_ATTR = 'data-raster-fit';

/** Marks a wrapper this module inserted, so a re-run is idempotent. */
const FRAME_CLASS = 'raster-fit-frame';

/* ------------------------------------------------------------------ *
 * Geometry
 * ------------------------------------------------------------------ */

/**
 * Resolve one axis of `object-position` to a pixel offset inside the content box.
 *
 * Per spec a percentage aligns the same relative point of image and box, which
 * for an image of size `drawn` in a box of size `box` is `(box - drawn) * p`.
 * A length is a plain offset from the start edge.
 *
 * @param {string} token one component of the computed `object-position`
 * @param {number} slack `box - drawn` for this axis (may be negative for `cover`)
 * @returns {number} offset in CSS pixels from the start edge
 */
function resolvePosition(token, slack) {
  const t = String(token || '50%').trim();
  if (t === 'left' || t === 'top') return 0;
  if (t === 'right' || t === 'bottom') return slack;
  if (t === 'center') return slack / 2;
  if (t.endsWith('%')) {
    const p = parseFloat(t);
    return Number.isFinite(p) ? (slack * p) / 100 : slack / 2;
  }
  const px = parseFloat(t);
  return Number.isFinite(px) ? px : slack / 2;
}

/**
 * The size the browser actually paints the image at, for a given `object-fit`.
 * @param {string} fit computed `object-fit`
 * @param {number} nw natural width @param {number} nh natural height
 * @param {number} cw content-box width @param {number} ch content-box height
 * @returns {{w:number, h:number}|null} null when `fit` needs no correction
 */
function drawnSize(fit, nw, nh, cw, ch) {
  switch (fit) {
    case 'contain': {
      const s = Math.min(cw / nw, ch / nh);
      return { w: nw * s, h: nh * s };
    }
    case 'cover': {
      const s = Math.max(cw / nw, ch / nh);
      return { w: nw * s, h: nh * s };
    }
    case 'none':
      return { w: nw, h: nh };
    case 'scale-down': {
      const s = Math.min(1, Math.min(cw / nw, ch / nh));
      return { w: nw * s, h: nh * s };
    }
    default:
      // 'fill' (and anything unrecognised): stretching to the box is already
      // what the browser does, which is also what html2canvas does. Leave it.
      return null;
  }
}

/**
 * Measure one image and return everything needed to rebuild it, or null when it
 * needs no correction (fill, not yet decoded, or zero-sized).
 * @param {HTMLImageElement} img
 * @returns {object|null}
 */
function measure(img) {
  const nw = img.naturalWidth;
  const nh = img.naturalHeight;
  if (!nw || !nh) return null; // broken or still decoding — leave it alone

  const cs = getComputedStyle(img);
  const fit = cs.objectFit || 'fill';

  const padL = parseFloat(cs.paddingLeft) || 0;
  const padR = parseFloat(cs.paddingRight) || 0;
  const padT = parseFloat(cs.paddingTop) || 0;
  const padB = parseFloat(cs.paddingBottom) || 0;

  // clientWidth/Height are the padding box (border excluded, transforms ignored).
  const cw = img.clientWidth - padL - padR;
  const ch = img.clientHeight - padT - padB;
  if (cw <= 0 || ch <= 0) return null;

  const drawn = drawnSize(fit, nw, nh, cw, ch);
  if (!drawn) return null;

  // Already correct to within a rounding error? Wrapping would only add risk.
  if (Math.abs(drawn.w - cw) < 0.5 && Math.abs(drawn.h - ch) < 0.5) return null;

  const parts = String(cs.objectPosition || '50% 50%').split(/\s+/);
  const left = resolvePosition(parts[0], cw - drawn.w) + padL + (img.clientLeft || 0);
  const top = resolvePosition(parts[1] !== undefined ? parts[1] : parts[0], ch - drawn.h) +
    padT + (img.clientTop || 0);

  return {
    frameW: img.offsetWidth,
    frameH: img.offsetHeight,
    w: drawn.w,
    h: drawn.h,
    left,
    top,
    position: cs.position,
    inset: [cs.top, cs.right, cs.bottom, cs.left],
    zIndex: cs.zIndex,
    margin: cs.margin,
    radius: cs.borderRadius,
    align: cs.alignSelf,
    justify: cs.justifySelf,
    grid: [cs.gridArea, cs.gridColumn, cs.gridRow]
  };
}

/**
 * Rebuild one image as frame + absolutely positioned child.
 * @param {HTMLImageElement} img
 * @param {object} m the result of {@link measure}
 */
function rewrite(img, m) {
  const parent = img.parentNode;
  if (!parent) return;
  if (parent.classList && parent.classList.contains(FRAME_CLASS)) return; // idempotent

  const frame = img.ownerDocument.createElement('span');
  frame.className = FRAME_CLASS;
  const frameStyle = [
    'display:block',
    'box-sizing:border-box',
    `width:${m.frameW}px`,
    `height:${m.frameH}px`,
    'flex:0 0 auto',
    'overflow:hidden',
    `margin:${m.margin}`,
    `border-radius:${m.radius}`
  ];

  if (m.position && m.position !== 'static') {
    // Keep an absolutely/relatively placed image exactly where it was.
    frameStyle.push(
      `position:${m.position}`,
      `top:${m.inset[0]}`,
      `right:${m.inset[1]}`,
      `bottom:${m.inset[2]}`,
      `left:${m.inset[3]}`,
      `z-index:${m.zIndex}`
    );
  } else {
    frameStyle.push('position:relative');
  }
  if (m.align && m.align !== 'auto') frameStyle.push(`align-self:${m.align}`);
  if (m.justify && m.justify !== 'auto') frameStyle.push(`justify-self:${m.justify}`);
  if (m.grid[0] && m.grid[0] !== 'auto / auto / auto / auto') {
    frameStyle.push(`grid-column:${m.grid[1]}`, `grid-row:${m.grid[2]}`);
  }
  frame.setAttribute('style', frameStyle.join(';'));

  parent.insertBefore(frame, img);
  frame.appendChild(img);

  img.style.position = 'absolute';
  img.style.left = `${m.left}px`;
  img.style.top = `${m.top}px`;
  img.style.right = 'auto';
  img.style.bottom = 'auto';
  img.style.width = `${m.w}px`;
  img.style.height = `${m.h}px`;
  img.style.maxWidth = 'none';
  img.style.maxHeight = 'none';
  img.style.minWidth = '0';
  img.style.minHeight = '0';
  img.style.margin = '0';
  img.style.padding = '0';
  img.style.flex = '0 0 auto';
  // The whole point: html2canvas stretches source -> box, and now they match.
  img.style.objectFit = 'fill';
}

/* ------------------------------------------------------------------ *
 * Text
 * ------------------------------------------------------------------ */

/**
 * Turn off automatic hyphenation for the raster pass. Only elements that
 * actually resolve to `hyphens: auto` are touched, and they become `manual`
 * rather than `none`, so an explicit soft hyphen would still be honoured.
 * @param {HTMLElement} root
 */
function disableAutoHyphens(root) {
  const nodes = [root].concat(Array.from(root.querySelectorAll('*')));
  for (const el of nodes) {
    if (!el.style) continue;
    const cs = getComputedStyle(el);
    const h = cs.hyphens || cs.webkitHyphens;
    if (h !== 'auto') continue;
    el.style.hyphens = 'manual';
    el.style.webkitHyphens = 'manual';
  }
}

/* ------------------------------------------------------------------ *
 * Public API
 * ------------------------------------------------------------------ */

/**
 * Rewrite a subtree in place so html2canvas renders it faithfully.
 *
 * Only safe on a node you own outright — an offscreen staging clone. Layout is
 * preserved exactly (every frame keeps its image's original border-box size),
 * so anything already measured against this tree, `applyAutoFit()` included,
 * stays valid.
 *
 * @param {HTMLElement} root subtree to prepare
 * @returns {number} how many images were rewritten
 */
export function prepareForRaster(root) {
  if (!root || typeof root.querySelectorAll !== 'function') return 0;
  disableAutoHyphens(root);

  // Measure everything before touching anything: rewriting one image reflows
  // the document, and a half-measured tree would produce wrong geometry.
  const imgs = Array.from(root.querySelectorAll('img'));
  const plan = imgs.map((img) => ({ img, m: measure(img) })).filter((p) => p.m);
  for (const { img, m } of plan) rewrite(img, m);
  return plan.length;
}

/**
 * Measure a *live* subtree and stash the results on the elements themselves, for
 * {@link applyRasterMarks} to consume inside html2canvas's `onclone`.
 *
 * Splitting measure from rewrite is what makes the live case correct: inside
 * `onclone` the cloned images may not have decoded yet, so `naturalWidth` there
 * cannot be trusted, while on screen it always can.
 *
 * @param {HTMLElement} root live subtree about to be rasterised
 * @returns {() => void} call to remove every attribute this added
 */
export function markForRaster(root) {
  if (!root || typeof root.querySelectorAll !== 'function') return () => {};
  const marked = [];
  for (const img of Array.from(root.querySelectorAll('img'))) {
    const m = measure(img);
    if (!m) continue;
    img.setAttribute(FIT_ATTR, JSON.stringify(m));
    marked.push(img);
  }
  return () => {
    for (const img of marked) img.removeAttribute(FIT_ATTR);
  };
}

/**
 * html2canvas `onclone` half: apply the marks {@link markForRaster} left behind.
 * @param {Document} clonedDoc the cloned document html2canvas hands over
 * @param {HTMLElement} [clonedRoot] the cloned reference element, when provided
 */
export function applyRasterMarks(clonedDoc, clonedRoot) {
  const root = clonedRoot || (clonedDoc && clonedDoc.body);
  if (!root || typeof root.querySelectorAll !== 'function') return;

  disableAutoHyphens(root);

  for (const img of Array.from(root.querySelectorAll(`img[${FIT_ATTR}]`))) {
    let m = null;
    try {
      m = JSON.parse(img.getAttribute(FIT_ATTR));
    } catch (err) {
      m = null;
    }
    img.removeAttribute(FIT_ATTR);
    if (m) rewrite(img, m);
  }
}
