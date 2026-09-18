/**
 * canvas.js — the poster renderer and the interactive canvas.
 *
 * `buildPoster()` is deliberately the single rendering path used by the on-screen
 * stage, the raster PDF exporter and the vector print route. It takes a
 * pixels-per-inch value and sizes everything as `inches * ppi`, so "zoom" is just
 * a smaller ppi rather than a CSS transform. That is what makes the screen an
 * honest preview of the printed sheet: the same code produces both.
 */

import {
  posterState,
  computeColumnWidths,
  findBlock,
  splitBlock,
  removeBlock,
  setBlockType,
  moveBlock
} from '../posterState.js';
import { mountImage, resolveImageSrc, toast } from '../storage.js';
import { uid } from '../data.js';
import { serializeProse, serializeInline } from '../markdownSerialize.js';

/** CSS pixels per inch at zoom 1. */
const PPI_BASE = 96;

/** Type size ratios, expressed as multiples of the body text size. */
const TITLE_RATIO = 3.1;
const AUTHORS_RATIO = 1.35;
const AFFILIATIONS_RATIO = 0.95;
const BLOCK_TITLE_RATIO = 1.22;

/** Section-header banner text, as a multiple of the body size. */
const SECTION_RATIO = 1.6;

/** Caption text under a figure, as a multiple of the body size. */
const CAPTION_RATIO = 0.82;

/**
 * Auto-fit bounds. Text is never shrunk below `AUTOFIT_MIN` of its natural size —
 * past that it stops being readable at poster distance and the honest answer is
 * "this block has too much content", not a 4pt wall of grey.
 */
const AUTOFIT_MIN = 0.45;
const AUTOFIT_STEPS = 7;

/** How long a tree-navigation highlight stays on screen. */
const FLASH_MS = 1200;

/** Debounce for contenteditable commits, in ms. */
const INLINE_DEBOUNCE = 250;

/**
 * Debounce before re-rendering the Markdown a user is typing into the canvas.
 * Longer than the state commit above: the state should follow the keyboard
 * immediately (the sidebar mirrors it), but re-parsing the block under the
 * caret is only safe and only welcome once typing pauses.
 */
const LIVE_RENDER_DEBOUNCE = 500;

/**
 * Zoom thresholds for the toolbar's ✎ button. A poster fits the stage at about
 * 19%, where 24 pt body text paints at roughly 4 px — legible as a shape, not
 * as characters, and impossible to place a caret in. Below EDIT_ZOOM_MIN the
 * button zooms to EDIT_ZOOM (~14 px body text) before focusing. Above it the
 * view is left exactly where the user put it: pressing a button is consent to
 * move the view, but only as far as it has to go.
 */
const EDIT_ZOOM_MIN = 0.45;
const EDIT_ZOOM = 0.6;

/** Offered in the hover menu's size dropdown. Points, as printers count them. */
const PT_PRESETS = [8, 10, 12, 14, 18, 24, 32, 40, 48, 60, 72, 96, 128];

/* ------------------------------------------------------------------ *
 * Small DOM helpers
 * ------------------------------------------------------------------ */

/**
 * @param {string} tag
 * @param {string} [className]
 * @param {object} [style] inline style properties to assign
 * @returns {HTMLElement}
 */
function el(tag, className, style) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (style) Object.assign(node.style, style);
  return node;
}

/** Coerce to a finite number, falling back when the value is unusable. */
function num(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** Inches -> a CSS px string at the given resolution. */
function px(inches, ppi) {
  return `${num(inches, 0) * ppi}px`;
}

/**
 * A CSS colour -> the space-separated `R G B` triplet that `rgb(… / a)` wants.
 *
 * Only the forms the app can actually produce are handled: `<input type=color>`
 * always yields `#rrggbb`, and imported files may carry shorthand hex or an
 * `rgb()/rgba()` string. Anything else falls back rather than emitting a broken
 * value, because these feed tint colours that must never break the print path.
 */
function rgbChannels(color, fallback) {
  const value = String(color === null || color === undefined ? '' : color).trim();

  const hex = /^#([0-9a-f]{3,8})$/i.exec(value);
  if (hex) {
    const digits = hex[1];
    const full = digits.length === 3 || digits.length === 4
      ? digits.slice(0, 3).split('').map((d) => d + d).join('')
      : digits.slice(0, 6);
    if (full.length === 6) {
      const n = parseInt(full, 16);
      return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
    }
  }

  const fn = /^rgba?\(([^)]+)\)$/i.exec(value);
  if (fn) {
    const parts = fn[1].split(/[\s,/]+/).filter(Boolean).slice(0, 3).map(Number);
    if (parts.length === 3 && parts.every(Number.isFinite)) {
      return parts.map((p) => Math.max(0, Math.min(255, Math.round(p)))).join(' ');
    }
  }

  return fallback;
}

/** First defined, non-null value — `??` chained over a list. */
function pick(...values) {
  for (const v of values) {
    if (v !== null && v !== undefined && v !== '') return v;
  }
  return undefined;
}

/**
 * Merge a block's optional overrides over the global style.
 * Any null/undefined override means "inherit".
 * @param {object} block
 * @param {object} global state.style
 * @returns {object} fully resolved style values
 */
function resolveBlockStyle(block, global) {
  const s = (block && block.style) || {};
  return {
    bg: pick(s.bg, global.blockBg),
    opacity: num(pick(s.opacity, global.blockOpacity), 1),
    fontScale: num(pick(s.fontScale, 1), 1),
    // An explicit point size for this block, or null to inherit the global body
    // size. Unlike the other overrides this one has no global counterpart: pt
    // and the inches-based body size are two ways of saying the same thing, and
    // only one of them can win.
    fontPt: Number.isFinite(Number(s.fontPt)) && Number(s.fontPt) > 0 ? Number(s.fontPt) : null,
    textColor: pick(s.textColor, global.bodyColor),
    headingColor: pick(s.headingColor, global.headingColor),
    borderColor: pick(s.borderColor, global.blockBorderColor),
    showBorder: s.showBorder === null || s.showBorder === undefined
      ? global.showBlockBorders !== false
      : !!s.showBorder,
    paddingIn: num(pick(s.paddingIn, global.blockPaddingIn), 0.3),
    radiusIn: num(pick(s.radiusIn, global.blockRadiusIn), 0.12),
    align: s.align || 'left'
  };
}

/* ------------------------------------------------------------------ *
 * Auto-fit typography
 * ------------------------------------------------------------------ */

/**
 * Shrink the text inside every `[data-autofit]` element until it stops
 * overflowing, then leave it alone.
 *
 * This runs AFTER the poster is in a laid-out DOM rather than inside
 * `buildPoster()`, because it needs real measurements — `scrollHeight` on an
 * unattached node is meaningless. Every consumer of `buildPoster()` therefore
 * calls it once the node is parented: the on-screen stage, the off-screen PDF
 * stage and the print root all go through here, which is what keeps the three
 * routes visually identical.
 *
 * The search is a fixed-iteration bisection on a font-size multiplier rather
 * than a shrink-by-1%-and-remeasure loop: 7 forced reflows per element with a
 * predictable ceiling, instead of up to 55 with none.
 *
 * @param {HTMLElement} posterEl a `.poster` root that is attached and laid out
 * @returns {number} how many elements were actually scaled down
 */
export function applyAutoFit(posterEl) {
  if (!posterEl) return 0;
  const targets = posterEl.querySelectorAll('[data-autofit]');
  let shrunk = 0;

  for (const node of targets) {
    // Re-measuring must start from the unscaled size, or a second pass over an
    // already-fitted poster would compound the reductions.
    node.style.removeProperty('--ps-autofit');
    if (!overflows(node)) continue;

    let lo = AUTOFIT_MIN;   // known to fit, or the floor we accept regardless
    let hi = 1;             // known to overflow
    for (let i = 0; i < AUTOFIT_STEPS; i += 1) {
      const mid = (lo + hi) / 2;
      node.style.setProperty('--ps-autofit', String(mid));
      if (overflows(node)) hi = mid;
      else lo = mid;
    }
    node.style.setProperty('--ps-autofit', String(lo));
    shrunk += 1;
  }

  return shrunk;
}

/**
 * Does this element's content spill past its box?
 *
 * The 1px tolerance absorbs sub-pixel rounding: at fractional zoom levels a
 * perfectly-fitting line routinely measures a scrollHeight 0.4px taller than
 * its clientHeight, and without the slack every block would shrink slightly.
 */
function overflows(node) {
  return node.scrollHeight > node.clientHeight + 1 ||
         node.scrollWidth > node.clientWidth + 1;
}

/* ------------------------------------------------------------------ *
 * Markdown + LaTeX
 * ------------------------------------------------------------------ */

/**
 * Pull `$$…$$` and `$…$` spans out of the source before Markdown ever sees them,
 * so a parser cannot mangle underscores, asterisks or backslashes inside TeX.
 *
 * Inline spans are only accepted when they look like maths rather than currency:
 * no line breaks and no whitespace hugging either delimiter, which is what keeps
 * "$5 and $7" prose.
 *
 * @param {string} src
 * @returns {{text:string, math:Array<{tex:string, display:boolean}>}}
 */
function extractMath(src) {
  const math = [];
  let out = '';
  let i = 0;

  while (i < src.length) {
    const ch = src[i];

    // A backslash-escaped dollar is literal text; pass it straight through.
    if (ch === '\\' && src[i + 1] === '$') {
      out += '\\$';
      i += 2;
      continue;
    }

    if (ch === '$') {
      const display = src[i + 1] === '$';
      const delim = display ? '$$' : '$';
      const start = i + delim.length;
      const end = findClosingDelimiter(src, start, delim);

      if (end !== -1) {
        const tex = src.slice(start, end);
        if (isPlausibleMath(tex, display)) {
          math.push({ tex, display });
          out += mathToken(math.length - 1);
          i = end + delim.length;
          continue;
        }

        // Rejected: emit the whole candidate verbatim and consume its closing
        // delimiter too. Dropping only the opening `$` would let the closer open
        // a fresh span and swallow the prose after it — that is how
        // "$1.2$-$3.4$" used to hand the separator alone to KaTeX.
        out += src.slice(i, end + delim.length);
        i = end + delim.length;
        continue;
      }
    }

    out += ch;
    i += 1;
  }

  return { text: out, math };
}

/** A token no Markdown parser will alter: lowercase letters and digits only. */
function mathToken(index) {
  return `xxmathtok${index}xx`;
}

/** Index of the next unescaped `delim` at or after `from`, or -1. */
function findClosingDelimiter(src, from, delim) {
  for (let i = from; i < src.length; i += 1) {
    if (src[i] === '\\') {
      i += 1; // skip the escaped character
      continue;
    }
    if (src.startsWith(delim, i)) return i;
  }
  return -1;
}

/** Reject the common false positives before treating a `$…$` span as maths. */
function isPlausibleMath(tex, display) {
  if (!tex || !tex.trim()) return false;
  if (display) return true;
  if (/\n/.test(tex)) return false;
  if (/^\s|\s$/.test(tex)) return false;
  // A bare number is deliberately allowed: "$0.90$" and "$1.2$" are ordinary
  // poster maths. Currency prose ("$5 and $7") is already rejected above,
  // because the span between two amounts always carries whitespace.
  return true;
}

/**
 * Typeset one extracted span. Falls back to readable source text whenever KaTeX
 * is unavailable (offline) or the TeX does not parse.
 */
function renderMathToken(entry) {
  const raw = entry.display ? `$$${entry.tex}$$` : `$${entry.tex}$`;
  let inner = null;

  if (window.katex && typeof window.katex.renderToString === 'function') {
    try {
      inner = window.katex.renderToString(entry.tex, {
        displayMode: entry.display,
        throwOnError: false,
        output: 'html'
      });
    } catch (err) {
      console.warn('KaTeX failed to render a span; showing the source instead', err);
    }
  }
  if (inner === null) {
    const cls = entry.display ? 'math-raw math-raw--display' : 'math-raw';
    inner = `<code class="${cls}">${escapeForHtml(raw)}</code>`;
  }

  // Wrapped so live canvas editing can round-trip it: `data-md` carries the TeX
  // source back out (markdownSerialize.js reads it verbatim), and
  // contenteditable=false makes the several hundred nodes KaTeX emits behave as
  // one atomic character rather than something the caret can wander into.
  return `<span class="ps-math" data-md="${escapeForHtml(raw)}" contenteditable="false">${inner}</span>`;
}

/** Escape the five characters that matter in HTML text/attribute position. */
function escapeForHtml(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Minimal Markdown renderer used when the `marked` CDN script is unavailable.
 * Covers the subset a poster actually needs: ATX headings, bold, italic, strike,
 * inline code, fenced code, links, images, unordered/ordered lists with one level
 * of nesting, blockquotes, horizontal rules, GFM tables and paragraphs.
 *
 * @param {string} src
 * @returns {string} HTML
 */
function miniMarkdown(src) {
  const lines = String(src).replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let i = 0;

  const inline = (text) => {
    // The hover menu's point-size spans are the one piece of raw HTML the app
    // authors itself, so they are lifted out before the escape pass and put
    // back afterwards. Without this the offline route would print the literal
    // `<span class="ps-pt">` a user sees nothing of when `marked` is available.
    const sized = [];
    const lifted = String(text).replace(
      /<span class="ps-pt"([^>]*)>([\s\S]*?)<\/span>/g,
      (_m, attrs, body) => `xxpssizetok${sized.push({ attrs, body }) - 1}xx`
    );

    let s = escapeForHtml(lifted);
    // Inline code first, so its contents are not re-processed for emphasis.
    const codes = [];
    s = s.replace(/`([^`]+)`/g, (_m, code) => {
      codes.push(code);
      return ` code${codes.length - 1} `;
    });
    s = s
      .replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;[^&]*&quot;)?\)/g,
        (_m, alt, src2) => `<img src="${src2}" alt="${alt}">`)
      .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g,
        (_m, label, href) => `<a href="${href}" rel="noreferrer">${label}</a>`)
      .replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
      .replace(/__([^_]+)__/g, '<strong>$1</strong>')
      .replace(/~~([^~]+)~~/g, '<del>$1</del>');
    s = s.replace(/ code(\d+) /g, (_m, n) => `<code>${codes[Number(n)]}</code>`);
    s = s.replace(/xxpssizetok(\d+)xx/g, (match, n) => {
      const span = sized[Number(n)];
      return span ? `<span class="ps-pt"${span.attrs}>${inline(span.body)}</span>` : match;
    });
    return s;
  };

  const isTableDivider = (line) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(line);
  const splitRow = (line) => line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim());

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) { i += 1; continue; }

    // Fenced code
    if (/^\s*```/.test(line)) {
      const body = [];
      i += 1;
      while (i < lines.length && !/^\s*```/.test(lines[i])) { body.push(lines[i]); i += 1; }
      i += 1;
      out.push(`<pre><code>${escapeForHtml(body.join('\n'))}</code></pre>`);
      continue;
    }

    // Horizontal rule
    if (/^\s*([-*_])\s*(\1\s*){2,}$/.test(line)) { out.push('<hr>'); i += 1; continue; }

    // Heading
    const heading = /^\s*(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      out.push(`<h${level}>${inline(heading[2].replace(/\s+#+\s*$/, ''))}</h${level}>`);
      i += 1;
      continue;
    }

    // Table
    if (line.includes('|') && i + 1 < lines.length && isTableDivider(lines[i + 1])) {
      const head = splitRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
        rows.push(splitRow(lines[i]));
        i += 1;
      }
      const thead = `<thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead>`;
      const tbody = rows.length
        ? `<tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody>`
        : '';
      out.push(`<table>${thead}${tbody}</table>`);
      continue;
    }

    // Blockquote
    if (/^\s*>/.test(line)) {
      const body = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) {
        body.push(lines[i].replace(/^\s*>\s?/, ''));
        i += 1;
      }
      out.push(`<blockquote>${miniMarkdown(body.join('\n'))}</blockquote>`);
      continue;
    }

    // Lists (one level of nesting, detected by leading indent)
    const listItem = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line);
    if (listItem) {
      const ordered = /\d/.test(listItem[2]);
      const tag = ordered ? 'ol' : 'ul';
      const items = [];
      let open = false;

      while (i < lines.length) {
        const m = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(lines[i]);
        if (!m) break;
        const nested = m[1].length >= 2;
        const content = inline(m[3]);
        if (nested) {
          if (!open) { items.push(`<${tag}>`); open = true; }
          items.push(`<li>${content}</li>`);
        } else {
          if (open) { items.push(`</${tag}>`); open = false; }
          items.push(`<li>${content}</li>`);
        }
        i += 1;
      }
      if (open) items.push(`</${tag}>`);
      out.push(`<${tag}>${items.join('')}</${tag}>`);
      continue;
    }

    // Paragraph: consume until a blank line or the start of another construct.
    const para = [];
    while (
      i < lines.length && lines[i].trim() &&
      !/^\s*(#{1,6}\s|>|```)/.test(lines[i]) &&
      !/^(\s*)([-*+]|\d+[.)])\s+/.test(lines[i]) &&
      !/^\s*([-*_])\s*(\1\s*){2,}$/.test(lines[i])
    ) {
      para.push(lines[i]);
      i += 1;
    }
    if (para.length) out.push(`<p>${inline(para.join('\n')).replace(/\n/g, '<br>')}</p>`);
  }

  return out.join('\n');
}

/**
 * Remove anything executable from parsed Markdown before it reaches the document.
 * Works on a detached tree, so nothing runs while we inspect it.
 * @param {DocumentFragment} fragment
 */
function sanitizeFragment(fragment) {
  const walker = document.createTreeWalker(fragment, NodeFilter.SHOW_ELEMENT);
  const doomed = [];
  let node = walker.nextNode();

  while (node) {
    const tag = node.tagName.toLowerCase();
    if (tag === 'script' || tag === 'style' || tag === 'iframe' || tag === 'object' || tag === 'embed') {
      doomed.push(node);
    } else {
      for (const attr of Array.from(node.attributes)) {
        const name = attr.name.toLowerCase();
        const value = String(attr.value || '');
        if (name.startsWith('on')) {
          node.removeAttribute(attr.name);
        } else if ((name === 'href' || name === 'src' || name === 'xlink:href') &&
                   /^\s*javascript:/i.test(value)) {
          node.removeAttribute(attr.name);
        }
      }
    }
    node = walker.nextNode();
  }

  for (const bad of doomed) {
    if (bad.parentNode) bad.parentNode.removeChild(bad);
  }
}

/**
 * Render Markdown (with LaTeX) into an element.
 *
 * @param {string} md source text
 * @param {HTMLElement} targetEl element whose contents are replaced
 */
export function renderRichText(md, targetEl) {
  if (!targetEl) return;
  const source = typeof md === 'string' ? md : '';
  const { text, math } = extractMath(source);

  let html;
  if (window.marked && typeof window.marked.parse === 'function') {
    try {
      html = window.marked.parse(text, { breaks: true, gfm: true });
    } catch (err) {
      console.warn('marked failed; falling back to the built-in renderer', err);
      html = miniMarkdown(text);
    }
  } else {
    html = miniMarkdown(text);
  }

  // Restore the maths after parsing so KaTeX markup is never re-escaped.
  html = html.replace(/xxmathtok(\d+)xx/g, (match, index) => {
    const entry = math[Number(index)];
    return entry ? renderMathToken(entry) : match;
  });

  const template = document.createElement('template');
  template.innerHTML = html;
  sanitizeFragment(template.content);

  while (targetEl.firstChild) targetEl.removeChild(targetEl.firstChild);
  targetEl.appendChild(template.content);

  // Markdown images get the same graceful degradation as image blocks.
  for (const img of Array.from(targetEl.querySelectorAll('img'))) {
    attachImageFallback(img);
  }
}

/**
 * Swap a broken <img> for the neutral "No Image Available" panel, matching what
 * storage.mountImage() does for first-class image slots.
 * @param {HTMLImageElement} img
 */
function attachImageFallback(img) {
  img.addEventListener('error', () => {
    const path = img.getAttribute('src') || '';
    const wrap = el('span', 'ps-img-missing ps-img-missing--inline');

    const icon = el('span', 'ps-img-missing__icon');
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = '🖼';

    const text = el('span', 'ps-img-missing__text');
    text.textContent = 'No Image Available';

    const code = document.createElement('code');
    code.className = 'ps-img-missing__path';
    code.textContent = path || '(no path set)';

    wrap.appendChild(icon);
    wrap.appendChild(text);
    wrap.appendChild(code);
    if (img.parentNode) img.parentNode.replaceChild(wrap, img);
  }, { once: true });
}

/* ------------------------------------------------------------------ *
 * Poster construction
 * ------------------------------------------------------------------ */

/**
 * Build a complete, detached poster element sized in real pixels.
 *
 * @param {object} state poster state
 * @param {{ppi?:number, interactive?:boolean, selectedId?:string|null}} [opts]
 * @returns {HTMLElement} the `.poster` root, ready to append anywhere
 */
export function buildPoster(state, opts = {}) {
  const ppi = num(opts.ppi, PPI_BASE);
  const interactive = !!opts.interactive;
  const selectedId = opts.selectedId === undefined ? null : opts.selectedId;

  const canvas = state.canvas;
  const style = state.style;
  const header = state.header;

  const root = el('div', 'poster');
  root.style.width = px(canvas.widthIn, ppi);
  root.style.height = px(canvas.heightIn, ppi);

  // One body size drives everything else, so the whole sheet scales together.
  const bodyPx = num(style.baseFontIn, 0.34) * num(style.fontScale, 1) * ppi;
  root.style.fontSize = `${bodyPx}px`;

  const vars = {
    '--ps-ppi': String(ppi),
    '--ps-font': style.fontFamily,
    '--ps-font-scale': String(num(style.fontScale, 1)),
    // Section content scale — the sidebar slider that sizes Markdown h1–h4 and
    // paragraph text inside blocks, exactly as titleScale/authorsScale size the
    // header. Emitted here rather than applied per element so it costs one
    // custom property, and so the PDF and print routes inherit it for free:
    // they call this same function.
    '--ps-section-scale': String(num(style.sectionScale, 1)),
    // One typographic point in CSS pixels at the CURRENT resolution. Literal
    // `pt` units would be fixed at 1/72 in of the browser's idea of an inch and
    // would neither follow zoom nor survive export at another dpi; multiplying
    // by this keeps "24 pt" the same physical size on screen and on paper.
    '--ps-pt': `${ppi / 72}px`,
    '--ps-body': style.bodyColor,
    '--ps-heading': style.headingColor,
    '--ps-accent': style.accentColor,
    // Channel triplets so typography.css can tint with rgb(... / a) instead of
    // color-mix(). Chrome serialises a computed color-mix() as `color(srgb …)`,
    // which html2canvas 1.4.1 refuses to parse — that one function call used to
    // abort every raster PDF export.
    '--ps-accent-rgb': rgbChannels(style.accentColor, '47 122 201'),
    '--ps-body-rgb': rgbChannels(style.bodyColor, '28 35 48'),
    '--ps-block-bg': style.blockBg,
    '--ps-block-border': style.blockBorderColor,
    '--ps-header-bg': style.headerBg,
    '--ps-header-text': style.headerTextColor,
    '--ps-title-color': style.titleColor,
    '--ps-title-size': `${bodyPx * TITLE_RATIO * num(header.titleScale, 1)}px`,
    '--ps-authors-size': `${bodyPx * AUTHORS_RATIO * num(header.authorsScale, 1)}px`,
    '--ps-affiliations-size': `${bodyPx * AFFILIATIONS_RATIO * num(header.affiliationsScale, 1)}px`,
    '--ps-block-title-size': `${bodyPx * BLOCK_TITLE_RATIO}px`
  };
  for (const [key, value] of Object.entries(vars)) {
    if (value !== undefined && value !== null) root.style.setProperty(key, String(value));
  }

  root.appendChild(buildBackground(canvas, ppi));

  const content = el('div', 'poster__content', {
    paddingTop: px(canvas.margins.top, ppi),
    paddingRight: px(canvas.margins.right, ppi),
    paddingBottom: px(canvas.margins.bottom, ppi),
    paddingLeft: px(canvas.margins.left, ppi),
    gap: px(canvas.rowGapIn, ppi)
  });

  content.appendChild(buildHeader(header, ppi, interactive, selectedId));
  content.appendChild(buildBody(state, ppi, interactive, selectedId));
  root.appendChild(content);

  return root;
}

/** Solid colour plus the optional textured/photographic layer above it. */
function buildBackground(canvas, ppi) {
  const wrap = el('div', 'poster__bg');
  wrap.style.background = canvas.background.color || '#ffffff';

  if (canvas.background.useImage) {
    const src = resolveImageSrc({
      path: canvas.background.imagePath,
      dataUrl: canvas.background.imageDataUrl
    });
    if (src) {
      const fit = canvas.background.imageFit || 'cover';
      const layer = el('div', 'poster__bg-image', {
        backgroundImage: `url("${String(src).replace(/"/g, '\\"')}")`,
        opacity: String(num(canvas.background.imageOpacity, 0.25))
      });
      if (fit === 'tile') {
        layer.style.backgroundRepeat = 'repeat';
        layer.style.backgroundSize = `${ppi}px ${ppi}px`; // one tile per inch
      } else {
        layer.style.backgroundRepeat = 'no-repeat';
        layer.style.backgroundPosition = 'center';
        layer.style.backgroundSize = fit === 'contain' ? 'contain' : 'cover';
      }
      wrap.appendChild(layer);
    }
  }

  return wrap;
}

/** The fixed top band: logo, title block, logo. */
function buildHeader(header, ppi, interactive, selectedId) {
  const band = el('div', 'poster-header', {
    height: px(header.heightIn, ppi),
    gridTemplateColumns: `${px(header.logoLeft.widthIn, ppi)} 1fr ${px(header.logoRight.widthIn, ppi)}`,
    gap: px(0.3, ppi),
    padding: px(0.25, ppi),
    borderRadius: px(0.1, ppi)
  });

  band.appendChild(buildLogoBox(header.logoLeft, 'header.logoLeft', selectedId));

  const centre = el('div', 'poster-header__center');
  // The band's height is fixed by the user and it clips; because the centre
  // column is vertically centred, an overlong title used to lose glyphs off both
  // ends at once. Let it shrink the same way a block does — typography.css
  // multiplies all three header sizes by `--ps-autofit`.
  centre.dataset.autofit = 'header';
  centre.style.textAlign = header.align === 'left' ? 'left' : 'center';
  centre.appendChild(buildHeaderField('poster-title', 'header.title', header.title, interactive, selectedId));
  centre.appendChild(buildHeaderField('poster-authors', 'header.authors', header.authors, interactive, selectedId));
  centre.appendChild(buildHeaderField('poster-affiliations', 'header.affiliations', header.affiliations, interactive, selectedId));
  band.appendChild(centre);

  band.appendChild(buildLogoBox(header.logoRight, 'header.logoRight', selectedId));
  return band;
}

function buildLogoBox(logo, field, selectedId) {
  const box = el('div', 'poster-header__logo');
  box.dataset.field = field;
  if (selectedId === field) box.classList.add('is-selected');
  mountImage(box, logo.image, { fit: (logo.image && logo.image.fit) || 'contain' });
  return box;
}

/**
 * Ghost text for a header field the user has emptied. Without it a cleared
 * title collapses to a zero-height box with nothing left to click back into
 * (typography.css draws these from `data-placeholder` on `:empty`).
 */
const HEADER_PLACEHOLDERS = {
  'header.title': 'Poster title',
  'header.authors': 'Authors',
  'header.affiliations': 'Affiliations'
};

/**
 * Title, authors or affiliations.
 *
 * These render Markdown like every other writing surface on the sheet — an
 * author list wants **bold** for the presenting author and an affiliation line
 * wants *italics* — but they are inline contexts inside a fixed-height band, so
 * the paragraph wrappers `marked` produces are unwrapped: a `<p>`'s margins
 * would push the title off its own baseline.
 */
function buildHeaderField(className, field, value, interactive, selectedId) {
  const node = el('div', className);
  node.dataset.field = field;
  node.dataset.mdMode = 'inline';
  renderInlineRichText(value, node, { multiline: field === 'header.affiliations' });
  if (selectedId === field) node.classList.add('is-selected');
  if (interactive) {
    node.contentEditable = 'true';
    node.spellcheck = false;
    node.dataset.placeholder = HEADER_PLACEHOLDERS[field] || '';
    node.setAttribute('role', 'textbox');
    node.setAttribute('aria-label', field.split('.').pop());
  }
  return node;
}

/**
 * Render Markdown into an element that must stay inline-shaped.
 *
 * @param {string} md
 * @param {HTMLElement} targetEl
 * @param {{multiline?: boolean}} [opts] keep paragraph breaks as <br> pairs
 */
function renderInlineRichText(md, targetEl, opts = {}) {
  renderRichText(md, targetEl);

  const paragraphs = Array.from(targetEl.children).filter((c) => c.tagName === 'P');
  paragraphs.forEach((p, index) => {
    // Separate the runs the way the source did, so serialising the result gives
    // the newlines back.
    if (opts.multiline && index > 0) {
      targetEl.insertBefore(document.createElement('br'), p);
    }
    while (p.firstChild) targetEl.insertBefore(p.firstChild, p);
    targetEl.removeChild(p);
  });
}

/** The column strip below the header. */
function buildBody(state, ppi, interactive, selectedId) {
  const body = el('div', 'poster-body', { gap: px(state.canvas.columnGapIn, ppi) });
  const widths = computeColumnWidths(state);

  state.columns.forEach((column, index) => {
    const col = el('div', 'poster-column', {
      flex: `0 0 ${num(widths[index], 1) * ppi}px`,
      width: px(num(widths[index], 1), ppi)
    });
    col.dataset.columnId = column.id;
    col.appendChild(renderBlock(column.root, state, ppi, interactive, selectedId));
    body.appendChild(col);
  });

  return body;
}

/**
 * Recursively render one block. Splits become flex containers; leaves become
 * styled cards holding prose, a figure or a section banner.
 *
 * @param {string} stackAxis 'rows' when this block is stacked vertically by its
 *   parent (so a flex basis means height), 'cols' when it sits side by side.
 */
function renderBlock(block, state, ppi, interactive, selectedId, stackAxis = 'rows') {
  if (!block) return el('div');

  const node = block.kind === 'split'
    ? renderSplit(block, state, ppi, interactive, selectedId)
    : renderLeaf(block, state, ppi, interactive, selectedId);

  node.dataset.id = block.id;

  // Sizing within the parent split: an exact inch value wins over the ratio.
  // Section headers fall between the two — they take the poster-wide band
  // height from the global style so every band lines up, unless this particular
  // block has an explicit size to opt out with. Only meaningful when the parent
  // stacks vertically; side by side, a flex basis would set the width instead.
  const sectionIn = block.kind === 'leaf' && block.type === 'section' && stackAxis === 'rows'
    ? num(state.style && state.style.sectionHeaderIn, 0.9)
    : 0;

  if (Number.isFinite(block.fixedIn) && block.fixedIn > 0) {
    node.style.flex = `0 0 ${block.fixedIn * ppi}px`;
  } else if (sectionIn > 0) {
    node.style.flex = `0 0 ${sectionIn * ppi}px`;
  } else {
    node.style.flex = `${num(block.ratio, 1)} 1 0`;
  }
  // Without these a deeply nested split overflows its parent instead of shrinking.
  node.style.minWidth = '0';
  node.style.minHeight = '0';

  return node;
}

function renderSplit(block, state, ppi, interactive, selectedId) {
  const node = el('div', 'block-split', {
    display: 'flex',
    flexDirection: block.orientation === 'cols' ? 'row' : 'column',
    gap: px(block.gapIn, ppi)
  });
  node.dataset.kind = 'split';
  node.dataset.orientation = block.orientation;

  for (const child of block.children || []) {
    node.appendChild(renderBlock(child, state, ppi, interactive, selectedId, block.orientation));
  }
  return node;
}

function renderLeaf(block, state, ppi, interactive, selectedId) {
  if (block.type === 'section') return renderSectionHeader(block, state, ppi, interactive, selectedId);

  const s = resolveBlockStyle(block, state.style);

  const node = el('div', 'block', {
    background: s.bg,
    opacity: String(s.opacity),
    borderRadius: px(s.radiusIn, ppi),
    padding: px(s.paddingIn, ppi),
    color: s.textColor,
    textAlign: s.align,
    border: s.showBorder ? `${Math.max(1, 0.012 * ppi)}px solid ${s.borderColor}` : 'none'
  });
  node.dataset.kind = 'leaf';
  node.dataset.type = block.type;
  // An explicit point size wins over the inherited body size; "scale text" then
  // multiplies whichever of the two is in play, so the two controls compose
  // instead of cancelling each other out.
  if (s.fontPt) {
    node.style.fontSize = `calc(${s.fontPt} * var(--ps-pt) * ${s.fontScale})`;
  } else if (s.fontScale !== 1) {
    node.style.fontSize = `${s.fontScale}em`;
  }
  if (block.id === selectedId) node.classList.add('is-selected');

  if (block.label) {
    const title = el('div', 'block__title');
    title.style.color = s.headingColor;
    title.style.marginBottom = px(s.paddingIn * 0.5, ppi);
    title.textContent = block.label;
    if (interactive) makeEditable(title, { mode: 'text', target: 'label', label: 'Block heading' });
    node.appendChild(title);
  }

  const body = el('div', 'block__body');
  if (block.type === 'image') {
    body.classList.add('block__body--image');
    body.appendChild(buildFigure(block, ppi));
  } else {
    const prose = el('div', 'prose');
    renderRichText(block.markdown, prose);
    // Live Markdown editing: the rendered prose IS the editor. Keystrokes are
    // serialised straight back to Markdown and committed, and the block
    // re-parses itself once typing pauses (see the input handler in
    // mountCanvas). Double-click still opens the raw-source overlay for anyone
    // who wants to see the asterisks.
    if (interactive) makeEditable(prose, { mode: 'prose', target: 'markdown', label: 'Block content' });
    body.appendChild(prose);
    // The body, not the prose, is the auto-fit target: the body is the element
    // with the clipped height, so it is the one that can report an overflow.
    // `--ps-autofit` then inherits down to the prose, which consumes it.
    body.dataset.autofit = 'prose';
  }
  node.appendChild(body);

  if (interactive) node.appendChild(buildToolbar(block));
  return node;
}

/**
 * A picture with its Markdown caption underneath, as one unit.
 *
 * The pair is a flex column inside the block body: the picture takes whatever
 * height is left (`flex: 1` with `min-height: 0`, so it yields rather than
 * pushing the caption out) and the caption takes only what it needs, capped by
 * CSS at a share of the figure. Both are therefore bounded by the sub-block, as
 * required — and the caption is additionally an auto-fit target, so a long one
 * shrinks its type instead of clipping.
 */
function buildFigure(block, ppi) {
  const image = block.image || {};
  const figure = el('figure', 'block__figure');

  const frame = el('div', 'block__figure-media');
  mountImage(frame, image, { fit: image.fit || 'contain', label: block.label || image.path });
  figure.appendChild(frame);

  const caption = typeof image.caption === 'string' ? image.caption.trim() : '';
  if (caption) {
    const cap = el('figcaption', 'block__caption prose prose--caption', {
      marginTop: px(0.08, ppi)
    });
    // Natural size as a custom property rather than an inline `font-size`: the
    // stylesheet multiplies it by `--ps-autofit`, and an inline font-size would
    // win over that rule and silently disable shrinking.
    cap.style.setProperty('--ps-em', String(CAPTION_RATIO));
    cap.dataset.autofit = 'caption';
    renderRichText(caption, cap);
    figure.appendChild(cap);
  }

  return figure;
}

/**
 * A section-header band.
 *
 * Deliberately not a `.block` card: it has its own fill, no heading bar and no
 * body padding model, and `renderBlock()` gives it a globally fixed height so
 * bands align across columns. The banner text is an auto-fit target, so a long
 * title shrinks to fit the band instead of forcing the band taller.
 */
function renderSectionHeader(block, state, ppi, interactive, selectedId) {
  const s = resolveBlockStyle(block, state.style);
  const global = state.style || {};

  const node = el('div', 'block block--section', {
    background: pick(block.style && block.style.bg, global.sectionHeaderBg, '#0f3057'),
    opacity: String(s.opacity),
    borderRadius: px(s.radiusIn, ppi),
    padding: `0 ${px(s.paddingIn, ppi)}`,
    color: pick(block.style && block.style.textColor, global.sectionHeaderColor, '#ffffff'),
    textAlign: s.align === 'left' ? 'left' : s.align,
    border: s.showBorder ? `${Math.max(1, 0.012 * ppi)}px solid ${s.borderColor}` : 'none'
  });
  node.dataset.kind = 'leaf';
  node.dataset.type = 'section';
  if (block.id === selectedId) node.classList.add('is-selected');

  const banner = el('div', 'block__section-text');
  banner.style.setProperty('--ps-em', String(SECTION_RATIO * num(s.fontScale, 1)));
  banner.dataset.autofit = 'section';
  banner.textContent = (block.markdown || '').trim() || 'Section';
  // Plain text rather than Markdown: a band is one line of display type, and
  // letting a `#` in it become a heading inside a heading helps nobody.
  if (interactive) makeEditable(banner, { mode: 'text', target: 'markdown', label: 'Section title' });
  node.appendChild(banner);

  if (interactive) node.appendChild(buildToolbar(block));
  return node;
}

/**
 * Turn a rendered element into an in-place editor.
 *
 * Marks it up rather than binding listeners: every handler is delegated from
 * the stage in `mountCanvas()`, so re-rendering the poster stays free. The
 * dataset is the contract between the two halves —
 *
 *   data-editable = 'prose' | 'text'   how to read the DOM back out
 *   data-edit-target = 'markdown' | 'label'   which field of the block it writes
 *
 * @param {HTMLElement} node
 * @param {{mode:'prose'|'text', target:'markdown'|'label', label:string}} cfg
 */
function makeEditable(node, cfg) {
  node.contentEditable = 'true';
  node.spellcheck = false;
  node.dataset.editable = cfg.mode;
  node.dataset.editTarget = cfg.target;
  node.setAttribute('role', 'textbox');
  if (cfg.mode === 'prose') node.setAttribute('aria-multiline', 'true');
  node.setAttribute('aria-label', cfg.label);
  return node;
}

/** Human names for the three leaf content types, used in tooltips. */
const TYPE_LABELS = {
  markdown: 'text',
  image: 'image',
  section: 'section header'
};

/** The next type the toolbar's ⇄ button will switch a leaf to. */
function nextBlockType(type) {
  const order = ['markdown', 'section', 'image'];
  const at = order.indexOf(type);
  return order[(at + 1) % order.length] || 'section';
}

/**
 * Per-block action bar. Sized in fixed px on purpose: at 15% zoom a bar scaled by
 * ppi would be two pixels tall and unusable.
 */
function buildToolbar(block) {
  const bar = el('div', 'block-toolbar');
  const actions = [
    ['edit-text', '✎', 'Edit this text — zooms in far enough to read'],
    ['split-rows', '⬍', 'Split into rows'],
    ['split-cols', '⬌', 'Split into columns'],
    ['toggle-type', '⇄', `Change type — currently ${TYPE_LABELS[block.type] || 'text'}, next is ${TYPE_LABELS[nextBlockType(block.type)]}`],
    ['move-up', '↑', 'Move earlier'],
    ['move-down', '↓', 'Move later'],
    ['duplicate', '⧉', 'Duplicate this block'],
    ['delete', '✕', 'Delete this block']
  ];

  for (const [action, glyph, label] of actions) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'block-toolbar__btn';
    if (action === 'delete') btn.classList.add('block-toolbar__btn--danger');
    btn.dataset.action = action;
    btn.dataset.blockId = block.id;
    btn.title = label;
    btn.setAttribute('aria-label', label);
    btn.textContent = glyph;
    bar.appendChild(btn);
  }

  // Image blocks have no type of their own to size.
  if (block.type !== 'image') bar.appendChild(buildTypeControls(block));
  return bar;
}

/**
 * The type-size half of the hover menu: a point-size field, the same sizes as a
 * dropdown, and a scale slider.
 *
 * Point size applies to the current text selection when there is one — written
 * as a `<span class="ps-pt">` into the Markdown source — and to the whole block
 * otherwise, via `block.style.fontPt`. Scale is a multiplier on top of whatever
 * size is in force, which is why both controls can be used together.
 */
function buildTypeControls(block) {
  const style = (block && block.style) || {};
  const wrap = el('div', 'block-toolbar__sizes');

  const ptValue = Number.isFinite(Number(style.fontPt)) && Number(style.fontPt) > 0
    ? Number(style.fontPt)
    : '';

  const pt = document.createElement('input');
  pt.type = 'number';
  pt.className = 'block-toolbar__pt';
  pt.min = '4';
  pt.max = '600';
  pt.step = '1';
  pt.value = String(ptValue);
  pt.placeholder = 'pt';
  pt.title = 'Font size in points — applies to the selected text, or to the whole block when nothing is selected';
  pt.setAttribute('aria-label', 'Font size in points');
  pt.dataset.control = 'font-pt';
  pt.dataset.blockId = block.id;

  const preset = document.createElement('select');
  preset.className = 'block-toolbar__preset';
  preset.title = 'Preset font sizes';
  preset.setAttribute('aria-label', 'Preset font size');
  preset.dataset.control = 'font-preset';
  preset.dataset.blockId = block.id;
  const head = document.createElement('option');
  head.value = '';
  head.textContent = 'pt';
  preset.appendChild(head);
  for (const size of PT_PRESETS) {
    const option = document.createElement('option');
    option.value = String(size);
    option.textContent = String(size);
    if (Number(ptValue) === size) option.selected = true;
    preset.appendChild(option);
  }

  const scale = document.createElement('input');
  scale.type = 'range';
  scale.className = 'block-toolbar__scale';
  scale.min = '0.4';
  scale.max = '3';
  scale.step = '0.05';
  scale.value = String(num(style.fontScale, 1));
  scale.title = 'Scale this block’s text';
  scale.setAttribute('aria-label', 'Scale this block’s text');
  scale.dataset.control = 'font-scale';
  scale.dataset.blockId = block.id;

  wrap.append(pt, preset, scale);
  return wrap;
}

/* ------------------------------------------------------------------ *
 * Tree edits used by the toolbar
 * ------------------------------------------------------------------ */

/** Deep-clone a subtree, issuing fresh ids so the copy is independent. */
function cloneWithNewIds(block) {
  const copy = JSON.parse(JSON.stringify(block));
  const stamp = (node) => {
    node.id = uid(node.kind === 'split' ? 'split' : 'blk');
    if (Array.isArray(node.children)) node.children.forEach(stamp);
  };
  stamp(copy);
  return copy;
}

/**
 * Insert a copy of a block directly after it.
 * @returns {string|null} the new id, or null when the block is a column root
 */
function duplicateBlock(draft, id) {
  const hit = findBlock(draft, id);
  if (!hit || !hit.parent) return null;
  const copy = cloneWithNewIds(hit.block);
  hit.parent.children.splice(hit.index + 1, 0, copy);
  return copy.id;
}

/* ------------------------------------------------------------------ *
 * Interactive stage
 * ------------------------------------------------------------------ */

let inlineTimer = null;
let liveRenderTimer = null;
let activeEditor = null;

/** The editable element the caret is currently in, if any. */
let editingNode = null;

/** Last non-empty text selection made inside an editable (see selectionchange). */
let savedRange = null;

/** Zoom at the last full render, so a zoom change is never skipped. */
let lastRenderedZoom = null;

/** Flush any pending debounced inline edit immediately. */
function cancelInlineTimer() {
  if (inlineTimer) {
    clearTimeout(inlineTimer);
    inlineTimer = null;
  }
}

function cancelLiveRender() {
  if (liveRenderTimer) {
    clearTimeout(liveRenderTimer);
    liveRenderTimer = null;
  }
}

/** Write a header field, deferring the canvas re-render while the user types. */
function commitHeaderField(field, value, { live }) {
  const key = field.split('.')[1];
  if (!key) return;
  const current = posterState.get();
  if (current && current.header && current.header[key] === value) return false;
  posterState.update((draft) => {
    draft.header[key] = value;
  }, live ? { source: 'inline', silent: true } : {});
  return true;
}

/**
 * Write a block's Markdown or its heading.
 *
 * `{source: 'inline'}` is the re-entrancy guard: the canvas subscriber ignores
 * it, so the node the user is typing into is never rebuilt mid-keystroke, while
 * every OTHER subscriber — the sidebar, the autosave — still sees the change
 * immediately. `{silent: true}` keeps a burst of typing to one undo entry.
 *
 * @returns {boolean} true when the state actually changed
 */
function commitBlockField(id, target, value, { live }) {
  const hit = findBlock(posterState.get(), id);
  if (!hit) return false;
  const key = target === 'label' ? 'label' : 'markdown';
  if ((hit.block[key] || '') === value) return false;

  posterState.update((draft) => {
    const found = findBlock(draft, id);
    if (found) found.block[key] = value;
  }, live ? { source: 'inline', silent: true } : {});
  return true;
}

/* --- live editing plumbing --------------------------------------------- */

/**
 * Read an editable element back out as Markdown source.
 * @param {HTMLElement} node
 * @returns {string}
 */
function readEditable(node) {
  const mode = node.dataset.editable || (node.dataset.mdMode === 'inline' ? 'inline' : 'text');
  if (mode === 'prose') return serializeProse(node);
  if (mode === 'inline') {
    return serializeInline(node, { multiline: node.dataset.field === 'header.affiliations' });
  }
  // Plain-text surfaces (block heading, section band): innerText keeps the line
  // breaks a browser inserts as <div>/<br> without inventing Markdown for them.
  return node.innerText.replace(/\u00a0/g, ' ').replace(/\n+$/, '');
}

/** Commit whatever an editable currently holds. */
function commitEditable(node, { live }) {
  const value = readEditable(node);

  if (node.dataset.field) return commitHeaderField(node.dataset.field, value, { live });

  const blockEl = node.closest('.block[data-id]');
  if (!blockEl) return false;
  return commitBlockField(blockEl.dataset.id, node.dataset.editTarget || 'markdown', value, { live });
}

/** Is the caret sitting at the very end of `node`'s content? */
function caretAtEnd(node) {
  const selection = window.getSelection();
  if (!selection || !selection.rangeCount || !selection.isCollapsed) return false;
  const range = selection.getRangeAt(0);
  if (!node.contains(range.endContainer)) return false;

  const probe = range.cloneRange();
  probe.selectNodeContents(node);
  probe.setStart(range.endContainer, range.endOffset);
  // Only whitespace left after the caret counts as "the end" — a trailing
  // newline is what a contenteditable leaves behind constantly.
  return probe.toString().trim() === '';
}

function placeCaretAtEnd(node) {
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  range.selectNodeContents(node);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

/**
 * Re-parse the Markdown a user is typing and swap the rendered result in under
 * the caret.
 *
 * Only ever called with the caret at the end of the element, because that is
 * the one position that can be restored exactly: re-rendering changes the text
 * (`**bold**` loses four characters), so a character offset taken before the
 * swap would not mean the same thing after it. Typing in the middle of a
 * paragraph therefore renders when focus leaves instead — which is also when
 * the user has stopped caring where the caret was.
 */
function liveRerender(node) {
  const mode = node.dataset.editable || (node.dataset.mdMode === 'inline' ? 'inline' : '');
  if (mode !== 'prose' && mode !== 'inline') return;
  if (!caretAtEnd(node)) return;

  const source = readEditable(node);
  if (mode === 'inline') {
    renderInlineRichText(source, node, { multiline: node.dataset.field === 'header.affiliations' });
  } else {
    renderRichText(source, node);
  }
  placeCaretAtEnd(node);
}

/**
 * Render the poster into the stage and wire every interaction.
 * Listeners are bound once, here — never inside a render — so re-rendering is free.
 *
 * @param {HTMLElement} stageEl the scroll container
 * @returns {{render: () => void}}
 */
export function mountCanvas(stageEl) {
  if (!stageEl) throw new Error('mountCanvas requires a stage element');

  const render = () => {
    const state = posterState.get();
    const scrollLeft = stageEl.scrollLeft;
    const scrollTop = stageEl.scrollTop;

    closeEditor(false);
    cancelLiveRender();
    editingNode = null;

    lastRenderedZoom = num(posterState.ui.zoom, 0.2);
    const poster = buildPoster(state, {
      ppi: PPI_BASE * lastRenderedZoom,
      interactive: true,
      selectedId: posterState.ui.selectedId
    });

    while (stageEl.firstChild) stageEl.removeChild(stageEl.firstChild);
    stageEl.appendChild(poster);

    // Only measurable now that the poster is parented and laid out.
    applyAutoFit(poster);

    stageEl.scrollLeft = scrollLeft;
    stageEl.scrollTop = scrollTop;
  };

  /**
   * Move the `.is-selected` ring without rebuilding anything.
   *
   * Selection is the one piece of UI state that changes while the caret is
   * inside the poster, and a full rebuild there would throw away the element
   * being typed into. Everything else a selection affects (the hover toolbar) is
   * already present on every block and shown by CSS.
   *
   * @param {string|null} selectedId
   */
  const syncSelection = (selectedId) => {
    for (const node of Array.from(stageEl.querySelectorAll('.is-selected'))) {
      node.classList.remove('is-selected');
    }
    if (!selectedId) return;
    const key = CSS.escape(selectedId);
    const target = stageEl.querySelector(`.block[data-id="${key}"]`) ||
                   stageEl.querySelector(`[data-field="${key}"]`);
    if (target) target.classList.add('is-selected');
  };

  /** Select a block/field, but only when that is actually a change. */
  const select = (id) => {
    if (posterState.ui.selectedId === id) return;
    posterState.setUI({ selectedId: id, focusSource: id ? 'canvas' : null });
  };

  /* --- selection + toolbar ------------------------------------------- */
  stageEl.addEventListener('click', (event) => {
    const actionBtn = event.target.closest('[data-action]');
    if (actionBtn) {
      event.preventDefault();
      event.stopPropagation();
      runToolbarAction(actionBtn.dataset.action, actionBtn.dataset.blockId);
      return;
    }

    // The size controls live inside the block they act on. Letting the click
    // fall through would re-select that block and, before the guard below
    // existed, rebuild the very input the pointer is in.
    if (event.target.closest('[data-control]')) return;

    // `focusSource: 'canvas'` is what tells the sidebar to scroll its inspector
    // to this block. Only clicks on the poster set it; panel-driven selection
    // leaves it null so the panel never scrolls itself out from under the user.
    const field = event.target.closest('[data-field]');
    if (field) {
      select(field.dataset.field);
      return;
    }

    const blockEl = event.target.closest('.block[data-id]');
    if (blockEl) {
      select(blockEl.dataset.id);
      return;
    }

    if (!event.target.closest('.block__editor')) {
      select(null);
    }
  });

  /* --- inline text editing -------------------------------------------- */
  stageEl.addEventListener('dblclick', (event) => {
    const blockEl = event.target.closest('.block[data-id]');
    if (!blockEl) return;
    if (blockEl.dataset.type === 'image') {
      posterState.setUI({ selectedId: blockEl.dataset.id, focusSource: 'canvas' });
      toast('Set the image path in the Selected Block panel', 'info');
      return;
    }
    event.preventDefault();
    openEditor(blockEl);
  });

  /* --- live in-place editing ------------------------------------------ */

  /** The editable an event happened inside, or null. */
  const editableOf = (target) => {
    if (!target || !target.closest) return null;
    const node = target.closest('[data-editable], [data-field]');
    return node && node.isContentEditable ? node : null;
  };

  stageEl.addEventListener('focusin', (event) => {
    editingNode = editableOf(event.target);
  });

  stageEl.addEventListener('input', (event) => {
    const node = editableOf(event.target);
    if (!node) return;
    editingNode = node;

    // Two independent debounces. The short one pushes the text into the store so
    // the sidebar and autosave stay current; the long one re-parses the Markdown
    // so `**bold**` becomes bold without waiting for a blur.
    cancelInlineTimer();
    inlineTimer = setTimeout(() => {
      inlineTimer = null;
      commitEditable(node, { live: true });
    }, INLINE_DEBOUNCE);

    cancelLiveRender();
    liveRenderTimer = setTimeout(() => {
      liveRenderTimer = null;
      if (document.activeElement !== node) return;
      commitEditable(node, { live: true });
      liveRerender(node);
    }, LIVE_RENDER_DEBOUNCE);
  });

  // Rendered Markdown is the editing surface, so pasted HTML would arrive as
  // markup we never asked for. Paste the plain text and let it be parsed.
  stageEl.addEventListener('paste', (event) => {
    const node = editableOf(event.target);
    if (!node || !event.clipboardData) return;
    event.preventDefault();
    const text = event.clipboardData.getData('text/plain');
    if (text) document.execCommand('insertText', false, text);
  });

  stageEl.addEventListener('focusout', (event) => {
    const node = editableOf(event.target);
    if (!node) return;
    cancelInlineTimer();
    cancelLiveRender();
    if (editingNode === node) editingNode = null;

    commitEditable(node, { live: true });

    // Re-render this element in place rather than calling render(): focusout
    // fires between mousedown and click, so rebuilding the poster here would
    // delete whatever the user is clicking on and swallow the click. Skip it
    // entirely when focus is moving to this block's own toolbar, because the pt
    // control needs the text selection — and the nodes it points at — intact.
    const toToolbar = event.relatedTarget && event.relatedTarget.closest &&
                      event.relatedTarget.closest('.block-toolbar');
    if (toToolbar) return;

    const mode = node.dataset.editable || (node.dataset.mdMode === 'inline' ? 'inline' : 'text');
    const source = readEditable(node);
    if (mode === 'prose') {
      renderRichText(source, node);
    } else if (mode === 'inline') {
      renderInlineRichText(source, node, { multiline: node.dataset.field === 'header.affiliations' });
    }
  });

  stageEl.addEventListener('keydown', (event) => {
    const node = editableOf(event.target);
    if (!node) return;
    const singleLine = node.dataset.editable === 'text' ||
                       (node.dataset.field && node.dataset.field !== 'header.affiliations');

    if (event.key === 'Escape') {
      node.blur();
    } else if (event.key === 'Enter' && singleLine) {
      // Enter should not inject markup into a one-line surface.
      event.preventDefault();
      node.blur();
    } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      // Explicit "I am done" for multi-line prose: commit and re-parse now.
      event.preventDefault();
      node.blur();
    }
  });

  /* --- font size + text scale (toolbar) -------------------------------- */

  // `selectionchange` only fires on the document. Remembering the last real
  // selection is what makes the pt control selection-aware: clicking the input
  // collapses the live selection before any handler of ours can read it.
  document.addEventListener('selectionchange', () => {
    const selection = window.getSelection();
    if (!selection || !selection.rangeCount || selection.isCollapsed) return;
    const range = selection.getRangeAt(0);
    const host = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
      ? range.commonAncestorContainer
      : range.commonAncestorContainer.parentElement;
    const editable = host && host.closest ? host.closest('[data-editable]') : null;
    if (editable && stageEl.contains(editable)) savedRange = range.cloneRange();
  });

  stageEl.addEventListener('input', (event) => {
    const control = event.target.closest('[data-control]');
    if (!control) return;
    applySizeControl(control, { live: true });
  });

  stageEl.addEventListener('change', (event) => {
    const control = event.target.closest('[data-control]');
    if (!control) return;
    applySizeControl(control, { live: false });
  });

  posterState.subscribe((state, meta) => {
    // A re-render would destroy the node the user is typing into.
    if (meta && meta.source === 'inline') return;

    // Selecting a block while editing is a UI-only change: move the ring and
    // leave the DOM — and therefore the caret — alone. A zoom change still has
    // to rebuild, because every dimension on the poster is baked in pixels.
    //
    // `activeEditor` has to be in this guard as well as `editingNode`. The last
    // thing openEditor() does is setUI({selectedId}), which lands right here; if
    // only `editingNode` were checked, that notification would fall through to
    // render(), whose first act is closeEditor(false) — the overlay would be
    // torn down by the very call that finished building it. It survived until
    // now only by accident: a real double-click focuses the contenteditable
    // underneath on its way past, which sets `editingNode`. Double-clicking a
    // block's padding, where there is no editable to focus, never did.
    if ((editingNode || activeEditor) && meta && meta.uiOnly &&
        num(posterState.ui.zoom, 0.2) === lastRenderedZoom) {
      syncSelection(posterState.ui.selectedId);
      return;
    }
    render();
  });

  render();
  return { render };
}

/**
 * Apply one of the three toolbar size controls.
 *
 * `live` is true while a slider is being dragged or a number spun: the change is
 * written to the DOM by hand and committed silently, so the poster updates in
 * real time without a rebuild yanking the control out from under the pointer.
 * The matching `change` event then commits it properly, once, for undo.
 *
 * @param {HTMLElement} control the input/select carrying data-control
 * @param {{live:boolean}} opts
 */
function applySizeControl(control, { live }) {
  const id = control.dataset.blockId;
  if (!id) return;
  const blockEl = control.closest('.block[data-id]');
  const kind = control.dataset.control;

  if (kind === 'font-scale') {
    const scale = clampScale(Number(control.value));
    if (live && blockEl) paintFontSize(blockEl, readPt(blockEl), scale);
    writeBlockStyle(id, { fontScale: scale }, { live });
    return;
  }

  // Both pt controls mean the same thing; the dropdown just fills in the number.
  const raw = String(control.value).trim();
  const pt = raw === '' ? null : Number(raw);
  if (pt !== null && (!Number.isFinite(pt) || pt <= 0)) return;

  if (kind === 'font-preset') {
    const ptInput = blockEl && blockEl.querySelector('[data-control="font-pt"]');
    if (ptInput) ptInput.value = pt === null ? '' : String(pt);
  }

  // A highlighted run gets its own size; an empty selection sizes the block.
  if (pt !== null && applyPtToSelection(blockEl, pt)) return;

  if (live && blockEl) paintFontSize(blockEl, pt, readScale(blockEl));
  writeBlockStyle(id, { fontPt: pt }, { live });
}

function clampScale(value) {
  if (!Number.isFinite(value)) return 1;
  return Math.min(3, Math.max(0.4, value));
}

/** Current pt/scale as the toolbar shows them, so the two controls compose. */
function readPt(blockEl) {
  const input = blockEl.querySelector('[data-control="font-pt"]');
  const value = input ? Number(input.value) : NaN;
  return Number.isFinite(value) && value > 0 ? value : null;
}

function readScale(blockEl) {
  const input = blockEl.querySelector('[data-control="font-scale"]');
  return clampScale(input ? Number(input.value) : 1);
}

/** Mirror renderLeaf()/renderSectionHeader()'s sizing onto a live element. */
function paintFontSize(blockEl, pt, scale) {
  if (blockEl.dataset.type === 'section') {
    const banner = blockEl.querySelector('.block__section-text');
    if (banner) banner.style.setProperty('--ps-em', String(SECTION_RATIO * scale));
    return;
  }
  if (pt) {
    blockEl.style.fontSize = `calc(${pt} * var(--ps-pt) * ${scale})`;
  } else if (scale !== 1) {
    blockEl.style.fontSize = `${scale}em`;
  } else {
    blockEl.style.fontSize = '';
  }
}

/** Merge a patch into one block's style override. */
function writeBlockStyle(id, patch, { live }) {
  posterState.update((draft) => {
    const hit = findBlock(draft, id);
    if (!hit) return;
    hit.block.style = Object.assign({}, hit.block.style, patch);
  }, live ? { source: 'inline', silent: true } : {});
}

/**
 * Wrap the remembered selection in a sized span.
 *
 * `.ps-pt` is one of markdownSerialize's verbatim inline classes, so the span
 * survives the round trip back to Markdown source and out again — which is what
 * lets a single word keep its own size.
 *
 * @returns {boolean} true when a run was sized (so the block itself is left alone)
 */
function applyPtToSelection(blockEl, pt) {
  if (!savedRange || savedRange.collapsed || !blockEl) return false;

  const host = savedRange.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
    ? savedRange.commonAncestorContainer
    : savedRange.commonAncestorContainer.parentElement;
  const editable = host && host.closest ? host.closest('[data-editable]') : null;
  if (!editable || !blockEl.contains(editable)) return false;

  const span = document.createElement('span');
  span.className = 'ps-pt';
  span.style.setProperty('--pt', String(pt));
  try {
    span.appendChild(savedRange.extractContents());
    savedRange.insertNode(span);
  } catch (err) {
    // A selection spanning half of two different elements cannot be surrounded.
    console.warn('could not size the selection; sizing the block instead', err);
    return false;
  }
  savedRange = null;

  const blockId = blockEl.dataset.id;
  const value = readEditable(editable);
  posterState.update((draft) => {
    const hit = findBlock(draft, blockId);
    if (hit) hit.block[editable.dataset.editTarget === 'label' ? 'label' : 'markdown'] = value;
  });
  return true;
}

/** Apply one toolbar button. */
function runToolbarAction(action, id) {
  if (!id) return;

  switch (action) {
    case 'edit-text': {
      // Canvas editing has always worked; it was just unreachable. A 48″×36″
      // sheet fits the stage at about 19%, where body text paints at ~4 px —
      // too small to aim a caret at, which is why the preview read as dead.
      // This button does the aiming: zoom to something legible first, then put
      // the caret in the block's own editable.
      const hit = findBlock(posterState.get(), id);
      if (!hit || hit.block.kind !== 'leaf') return;

      if (num(posterState.ui.zoom, 0.2) < EDIT_ZOOM_MIN) {
        // The canvas subscriber renders synchronously, so by the time setUI
        // returns the stage holds rebuilt nodes — hence the lookup below runs
        // after it, never before.
        posterState.setUI({ zoom: EDIT_ZOOM });
      }

      const stage = document.getElementById('stage');
      const blockEl = stage && stage.querySelector(`.block[data-id="${CSS.escape(id)}"]`);
      // Prefer the body over the heading: on a text block the heading is
      // usually already filled in and the prose is what the user came for.
      const editable = blockEl && (
        blockEl.querySelector('[data-edit-target="markdown"]') ||
        blockEl.querySelector('[data-editable]')
      );
      if (!editable) {
        toast('This block has no text — set its content in the Selected Block panel', 'info');
        return;
      }

      // focus() before scrollIntoView(), and with preventScroll, so the
      // browser's own jump-to-focus does not fight the smooth scroll.
      editable.focus({ preventScroll: true });
      placeCaretAtEnd(editable);
      blockEl.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
      break;
    }
    case 'split-rows':
    case 'split-cols': {
      const orientation = action === 'split-rows' ? 'rows' : 'cols';
      const newId = posterState.update(
        (draft) => splitBlock(draft, id, orientation),
        { structural: true }
      );
      if (newId) posterState.setUI({ selectedId: newId, focusSource: 'canvas' });
      break;
    }
    case 'toggle-type': {
      const hit = findBlock(posterState.get(), id);
      if (!hit || hit.block.kind !== 'leaf') return;
      const next = nextBlockType(hit.block.type);
      posterState.update((draft) => setBlockType(draft, id, next), { structural: true });
      break;
    }
    case 'move-up':
      posterState.update((draft) => moveBlock(draft, id, -1), { structural: true });
      break;
    case 'move-down':
      posterState.update((draft) => moveBlock(draft, id, 1), { structural: true });
      break;
    case 'duplicate': {
      const newId = posterState.update((draft) => duplicateBlock(draft, id), { structural: true });
      if (newId) {
        posterState.setUI({ selectedId: newId, focusSource: 'canvas' });
      } else {
        toast('A column’s outermost block cannot be duplicated — split it first', 'warn');
      }
      break;
    }
    case 'delete': {
      const hit = findBlock(posterState.get(), id);
      if (!hit) return;
      if (!hit.parent) {
        toast('A column’s outermost block cannot be deleted — remove the column instead', 'warn');
        return;
      }
      posterState.update((draft) => removeBlock(draft, id), { structural: true });
      posterState.setUI({ selectedId: null });
      break;
    }
    default:
      break;
  }
}

/* --- the overlay textarea ---------------------------------------------- */

/** Open an editor over a markdown block's body. */
function openEditor(blockEl) {
  closeEditor(false);

  const id = blockEl.dataset.id;
  const hit = findBlock(posterState.get(), id);
  if (!hit || hit.block.kind !== 'leaf' || hit.block.type !== 'markdown') return;

  const body = blockEl.querySelector('.block__body');
  if (!body) return;

  const editor = document.createElement('textarea');
  editor.className = 'block__editor';
  editor.value = hit.block.markdown || '';
  editor.spellcheck = false;
  editor.dataset.blockId = id;

  const commit = (save) => closeEditor(save);

  editor.addEventListener('keydown', (event) => {
    event.stopPropagation(); // shortcuts must not fire while editing
    if (event.key === 'Escape') {
      event.preventDefault();
      commit(true);
    } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      commit(true);
    }
  });
  editor.addEventListener('blur', () => commit(true));
  editor.addEventListener('click', (event) => event.stopPropagation());
  editor.addEventListener('dblclick', (event) => event.stopPropagation());

  body.appendChild(editor);
  activeEditor = editor;

  editor.focus();
  editor.setSelectionRange(editor.value.length, editor.value.length);
  posterState.setUI({ selectedId: id });
}

/**
 * Tear down the open editor.
 * @param {boolean} save commit the text back into the block
 */
function closeEditor(save) {
  if (!activeEditor) return;
  const editor = activeEditor;
  activeEditor = null; // cleared first: committing triggers a re-render

  const id = editor.dataset.blockId;
  const value = editor.value;
  if (editor.parentNode) editor.parentNode.removeChild(editor);

  if (!save || !id) return;

  const hit = findBlock(posterState.get(), id);
  if (!hit || hit.block.markdown === value) return;

  posterState.update((draft) => {
    const target = findBlock(draft, id);
    if (target) target.block.markdown = value;
  });
}

/* ------------------------------------------------------------------ *
 * Navigation
 * ------------------------------------------------------------------ */

/**
 * Bring a block (or a header field) into view and flash it, so clicking an entry
 * in the document tree has an obvious result on a poster metres wide.
 * @param {string} id block id or a `header.*` field name
 */
export function scrollToBlock(id) {
  if (!id) return;
  const stage = document.getElementById('stage');
  if (!stage) return;

  const target = stage.querySelector(`[data-id="${CSS.escape(id)}"]`) ||
                 stage.querySelector(`[data-field="${CSS.escape(id)}"]`);
  if (!target) return;

  target.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
  target.classList.add('is-flash');
  setTimeout(() => target.classList.remove('is-flash'), FLASH_MS);
}

export { PPI_BASE };
