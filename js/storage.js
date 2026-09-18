/**
 * storage.js — IO + utility layer for Interactive Poster Studio.
 *
 * Responsibilities: localStorage persistence (debounced), defensive migration of any
 * previously-saved / hand-edited state, JSON + Markdown serialization, file import,
 * downloads, toasts and the shared image-mounting helper.
 *
 * This module may only import from ./data.js (contract §4).
 */

import { BLOCK_TYPES, createImage, createLeaf, defaultPoster, defaultStyle, uid } from './data.js';

/** localStorage key for the working copy of the poster. */
export const STORAGE_KEY = 'poster-studio:v1';

/** Schema version written into exports; migrate() upgrades anything older. */
const SCHEMA_VERSION = 1;

/** Debounce window for autosave. */
const SAVE_DEBOUNCE_MS = 400;

/** Maximum simultaneously visible toasts. */
const MAX_TOASTS = 4;

/** Hard cap on block nesting depth while migrating (protects against pathological files). */
const MAX_BLOCK_DEPTH = 24;

const GENERATOR_NOTE =
  'Interactive Poster Studio — client-side poster designer. Dimensions are in inches.';

const IMAGE_FITS = ['contain', 'cover', 'fill'];
const BG_FITS = ['cover', 'contain', 'tile'];
const ALIGNMENTS = ['left', 'center', 'right'];

/* ------------------------------------------------------------------ *
 * Small coercion helpers (shared by migrate + serializers)
 * ------------------------------------------------------------------ */

/**
 * @param {*} v
 * @returns {boolean} true for a non-null, non-array plain object
 */
function isObj(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Coerce to a finite number, else fall back.
 * @param {*} v @param {number} fallback @returns {number}
 */
function num(v, fallback) {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Coerce to a finite number clamped into [min,max], else fall back.
 */
function clampNum(v, min, max, fallback) {
  const n = num(v, fallback);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** Coerce to a finite positive number, else fall back. */
function posNum(v, fallback) {
  const n = num(v, NaN);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Coerce to a finite number >= 0, else fall back. */
function nonNegNum(v, fallback) {
  const n = num(v, NaN);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/** Coerce to a finite positive number, or null (the "auto" sentinel). */
function nullableNum(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = num(v, NaN);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** @param {*} v @param {string} fallback @returns {string} */
function str(v, fallback) {
  return typeof v === 'string' ? v : fallback;
}

/** @param {*} v @param {boolean} fallback @returns {boolean} */
function bool(v, fallback) {
  return typeof v === 'boolean' ? v : fallback;
}

/** @param {*} v @param {string[]} allowed @param {string} fallback @returns {string} */
function oneOf(v, allowed, fallback) {
  return typeof v === 'string' && allowed.includes(v) ? v : fallback;
}

/** Valid ISO-ish date string, else now. */
function isoDate(v) {
  if (typeof v === 'string' && v) {
    const t = Date.parse(v);
    if (Number.isFinite(t)) return new Date(t).toISOString();
  }
  return new Date().toISOString();
}

/** Structured deep copy with a JSON fallback for older engines. */
function deepCopy(value) {
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(value);
    } catch (_err) {
      /* fall through to JSON copy (e.g. non-cloneable stray fields) */
    }
  }
  return JSON.parse(JSON.stringify(value));
}

/**
 * Escape a value for safe insertion into an HTML text/attribute context.
 * @param {*} value value to escape
 * @returns {string}
 */
export function escapeHtml(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Turn a poster name into something safe for a filename (no extension). */
function safeFileName(name) {
  const base = String(name || '').trim() || 'Untitled_Poster';
  return base
    .replace(/[\\/:*?"<>|\x00-\x1f]+/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 120) || 'Untitled_Poster';
}

/* ------------------------------------------------------------------ *
 * Migration
 * ------------------------------------------------------------------ */

/**
 * Migrate an <Image>-ish value into a complete {path,dataUrl,alt,fit} object.
 * @param {*} raw @param {string} fallbackPath @param {string} [fallbackFit]
 * @returns {{path:string,dataUrl:(string|null),alt:string,fit:string}}
 */
function migrateImage(raw, fallbackPath = '', fallbackFit = 'contain') {
  const base = createImage(fallbackPath) || {};
  const baseFit = oneOf(base.fit, IMAGE_FITS, fallbackFit);
  if (typeof raw === 'string') {
    // Tolerate very old files that stored a bare path string.
    return { path: raw, dataUrl: null, alt: str(base.alt, ''), fit: baseFit, caption: '' };
  }
  if (!isObj(raw)) {
    return {
      path: str(base.path, fallbackPath),
      dataUrl: null,
      alt: str(base.alt, ''),
      fit: baseFit,
      caption: str(base.caption, '')
    };
  }
  const dataUrl = typeof raw.dataUrl === 'string' && raw.dataUrl.length > 0 ? raw.dataUrl : null;
  return {
    path: str(raw.path, str(base.path, fallbackPath)),
    dataUrl,
    alt: str(raw.alt, str(base.alt, '')),
    fit: oneOf(raw.fit, IMAGE_FITS, baseFit),
    // Absent in files written before captions existed; an empty string is the
    // correct "no caption" value and renders nothing.
    caption: str(raw.caption, str(base.caption, ''))
  };
}

/**
 * Migrate a per-block style override bag. Every value is either a usable
 * primitive or null (meaning "inherit from the global style").
 */
function migrateBlockStyle(raw) {
  const src = isObj(raw) ? raw : {};
  const nullableNumber = (v) => {
    if (v === null || v === undefined || v === '') return null;
    const n = num(v, NaN);
    return Number.isFinite(n) ? n : null;
  };
  const nullableString = (v) => (typeof v === 'string' && v ? v : null);
  return {
    bg: nullableString(src.bg),
    opacity: src.opacity === null || src.opacity === undefined || src.opacity === ''
      ? null
      : clampNum(src.opacity, 0, 1, 1),
    fontScale: nullableNumber(src.fontScale),
    // Added after v1 shipped: older files simply have no `fontPt`, and null is
    // exactly the "inherit the global body size" value they used to imply.
    fontPt: nullableNumber(src.fontPt),
    textColor: nullableString(src.textColor),
    headingColor: nullableString(src.headingColor),
    borderColor: nullableString(src.borderColor),
    showBorder: typeof src.showBorder === 'boolean' ? src.showBorder : null,
    paddingIn: nullableNumber(src.paddingIn),
    radiusIn: nullableNumber(src.radiusIn),
    align: oneOf(src.align, ALIGNMENTS, 'left')
  };
}

/**
 * Return a unique id, re-issuing one when the file contains duplicates.
 * @param {*} raw @param {string} prefix @param {Set<string>} seen
 */
function uniqueId(raw, prefix, seen) {
  let id = typeof raw === 'string' && raw.trim() ? raw.trim() : '';
  if (!id || seen.has(id)) id = uid(prefix);
  while (seen.has(id)) id = uid(prefix);
  seen.add(id);
  return id;
}

/**
 * Recursively migrate a block. Returns null only when the input is unusable
 * at a depth beyond the guard (the caller substitutes a fresh leaf).
 * @param {*} raw @param {Set<string>} seen @param {number} depth
 * @returns {object|null}
 */
function migrateBlock(raw, seen, depth) {
  if (depth > MAX_BLOCK_DEPTH) return null;
  if (!isObj(raw)) return freshLeaf(seen);

  const ratio = posNum(raw.ratio, 1);
  const fixedIn = nullableNum(raw.fixedIn);
  const looksSplit = raw.kind === 'split' || (raw.kind !== 'leaf' && Array.isArray(raw.children));

  if (looksSplit) {
    const rawKids = Array.isArray(raw.children) ? raw.children : [];
    const children = [];
    for (const kid of rawKids) {
      const migrated = migrateBlock(kid, seen, depth + 1);
      if (migrated) children.push(migrated);
    }
    if (children.length === 0) {
      // A split with no usable children is meaningless — degrade to a leaf.
      const leaf = freshLeaf(seen);
      leaf.ratio = ratio;
      leaf.fixedIn = fixedIn;
      if (typeof raw.label === 'string') leaf.label = raw.label;
      return leaf;
    }
    if (children.length === 1) {
      // Collapse a one-child split, inheriting the parent's sizing.
      const only = children[0];
      only.ratio = ratio;
      only.fixedIn = fixedIn;
      return only;
    }
    return {
      id: uniqueId(raw.id, 'blk', seen),
      kind: 'split',
      ratio,
      fixedIn,
      orientation: oneOf(raw.orientation, ['rows', 'cols'], 'rows'),
      gapIn: nonNegNum(raw.gapIn, 0.25),
      children
    };
  }

  return {
    id: uniqueId(raw.id, 'blk', seen),
    kind: 'leaf',
    ratio,
    fixedIn,
    type: oneOf(raw.type, BLOCK_TYPES, 'markdown'),
    label: str(raw.label, ''),
    markdown: str(raw.markdown, ''),
    image: migrateImage(raw.image, ''),
    style: migrateBlockStyle(raw.style)
  };
}

/** A brand new empty leaf with a guaranteed-unique id. */
function freshLeaf(seen) {
  const leaf = createLeaf();
  const migrated = migrateBlock({ ...leaf, id: undefined }, seen, MAX_BLOCK_DEPTH - 1);
  return migrated || {
    id: uniqueId(null, 'blk', seen),
    kind: 'leaf',
    ratio: 1,
    fixedIn: null,
    type: 'markdown',
    label: '',
    markdown: '',
    image: migrateImage(null, ''),
    style: migrateBlockStyle(null)
  };
}

/** Migrate one <Column>. */
function migrateColumn(raw, index, seen) {
  const src = isObj(raw) ? raw : {};
  const root = migrateBlock(src.root, seen, 0) || freshLeaf(seen);
  return {
    id: uniqueId(src.id, 'col', seen),
    label: str(src.label, `Column ${index + 1}`),
    widthIn: nullableNum(src.widthIn),
    root
  };
}

/** Migrate the global style bag by walking the canonical key set. */
function migrateStyle(raw) {
  const base = defaultStyle();
  const src = isObj(raw) ? raw : {};
  const out = {};
  for (const key of Object.keys(base)) {
    const fallback = base[key];
    const value = src[key];
    if (typeof fallback === 'number') {
      if (key === 'blockOpacity') {
        out[key] = clampNum(value, 0, 1, fallback);
      } else if (key === 'fontScale' || key === 'sectionScale') {
        // A scale of 0 (or a negative one from a hand-edited file) would render
        // the whole poster invisible with no obvious way back, so the sliders'
        // own bounds are enforced here too.
        out[key] = clampNum(value, 0.1, 5, fallback);
      } else {
        out[key] = num(value, fallback);
      }
    } else if (typeof fallback === 'boolean') {
      out[key] = bool(value, fallback);
    } else {
      out[key] = str(value, fallback);
    }
  }
  return out;
}

/** Migrate the canvas (page) description. */
function migrateCanvas(raw, base) {
  const src = isObj(raw) ? raw : {};
  const m = isObj(src.margins) ? src.margins : {};
  const bgBase = base.background;
  const bg = isObj(src.background) ? src.background : {};
  return {
    widthIn: posNum(src.widthIn, base.widthIn),
    heightIn: posNum(src.heightIn, base.heightIn),
    margins: {
      top: nonNegNum(m.top, base.margins.top),
      right: nonNegNum(m.right, base.margins.right),
      bottom: nonNegNum(m.bottom, base.margins.bottom),
      left: nonNegNum(m.left, base.margins.left)
    },
    columnGapIn: nonNegNum(src.columnGapIn, base.columnGapIn),
    rowGapIn: nonNegNum(src.rowGapIn, base.rowGapIn),
    background: {
      color: str(bg.color, bgBase.color),
      useImage: bool(bg.useImage, bgBase.useImage),
      imagePath: str(bg.imagePath, bgBase.imagePath),
      imageDataUrl:
        typeof bg.imageDataUrl === 'string' && bg.imageDataUrl ? bg.imageDataUrl : null,
      imageOpacity: clampNum(bg.imageOpacity, 0, 1, bgBase.imageOpacity),
      imageFit: oneOf(bg.imageFit, BG_FITS, bgBase.imageFit)
    }
  };
}

/** Migrate the header band, including both logo slots. */
function migrateHeader(raw, base) {
  const src = isObj(raw) ? raw : {};
  const logo = (key) => {
    const lb = base[key];
    const lr = isObj(src[key]) ? src[key] : {};
    return {
      widthIn: nonNegNum(lr.widthIn, lb.widthIn),
      image: migrateImage(lr.image, lb.image ? lb.image.path : '')
    };
  };
  return {
    heightIn: posNum(src.heightIn, base.heightIn),
    logoLeft: logo('logoLeft'),
    logoRight: logo('logoRight'),
    title: str(src.title, base.title),
    authors: str(src.authors, base.authors),
    affiliations: str(src.affiliations, base.affiliations),
    titleScale: posNum(src.titleScale, base.titleScale),
    authorsScale: posNum(src.authorsScale, base.authorsScale),
    affiliationsScale: posNum(src.affiliationsScale, base.affiliationsScale),
    align: oneOf(src.align, ['left', 'center'], base.align)
  };
}

/**
 * Defensively upgrade any parsed poster payload into the current state shape.
 * Missing or malformed fields fall back to `defaultPoster()`, so an old export
 * or a hand-edited JSON file can never crash the app.
 *
 * @param {*} raw parsed object (a JSON string is also accepted)
 * @returns {object|null} a complete state object, or null when unusable
 */
export function migrate(raw) {
  let input = raw;
  if (typeof input === 'string') {
    try {
      input = JSON.parse(input);
    } catch (_err) {
      return null;
    }
  }
  if (!isObj(input)) return null;

  const base = defaultPoster();
  const seen = new Set();
  const metaSrc = isObj(input.meta) ? input.meta : {};

  const rawColumns = Array.isArray(input.columns) ? input.columns.filter(Boolean) : [];
  const columns = rawColumns.length
    ? rawColumns.slice(0, 6).map((col, i) => migrateColumn(col, i, seen))
    : base.columns.map((col, i) => migrateColumn(col, i, seen));

  return {
    meta: {
      name: (str(metaSrc.name, '').trim() || base.meta.name),
      version: SCHEMA_VERSION,
      created: isoDate(metaSrc.created),
      modified: isoDate(metaSrc.modified),
      forkedFrom: typeof metaSrc.forkedFrom === 'string' && metaSrc.forkedFrom
        ? metaSrc.forkedFrom
        : null,
      // Which quick-start template this document came from, or null for a
      // document that predates templates. Purely informational — it drives the
      // "current" tick in the template chooser and nothing else, so an unknown
      // id from a newer build is harmless.
      templateId: typeof metaSrc.templateId === 'string' && metaSrc.templateId
        ? metaSrc.templateId
        : null
    },
    canvas: migrateCanvas(input.canvas, base.canvas),
    style: migrateStyle(input.style),
    header: migrateHeader(input.header, base.header),
    columns
  };
}

/* ------------------------------------------------------------------ *
 * Naming
 * ------------------------------------------------------------------ */

/**
 * Derive the next "copy" name: `X` → `X_Copy`, `X_Copy` → `X_Copy_2`,
 * `X_Copy_2` → `X_Copy_3`.
 * @param {string} name
 * @returns {string}
 */
export function forkName(name) {
  const base = String(name || '').trim() || 'Untitled_Poster';
  const m = /^(.*?)_Copy(?:_(\d+))?$/i.exec(base);
  if (!m) return `${base}_Copy`;
  const stem = m[1] || 'Untitled_Poster';
  const n = Number.parseInt(m[2] || '1', 10);
  const next = Number.isFinite(n) && n >= 1 ? n + 1 : 2;
  return `${stem}_Copy_${next}`;
}

/* ------------------------------------------------------------------ *
 * localStorage persistence
 * ------------------------------------------------------------------ */

let saveTimer = null;
let pendingState = null;

/** Guarded localStorage access (private browsing / disabled storage). */
function storage() {
  try {
    return window.localStorage || null;
  } catch (_err) {
    return null;
  }
}

/**
 * Persist the state immediately (no debounce). Falls back to a payload with
 * images stripped when the quota is exceeded.
 * @param {object} state
 * @returns {boolean} true when the write succeeded
 */
export function saveLocalNow(state) {
  if (saveTimer !== null) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  pendingState = null;
  const store = storage();
  if (!store || !isObj(state)) return false;
  try {
    store.setItem(STORAGE_KEY, serializeJSON(state, true));
    return true;
  } catch (err) {
    // Almost always QuotaExceededError from large embedded dataUrls.
    try {
      store.setItem(STORAGE_KEY, serializeJSON(state, false));
      toast('Autosave is too large — saved without embedded images.', 'warn', 4200);
      return true;
    } catch (_err2) {
      toast('Could not autosave to this browser: ' + (err && err.name ? err.name : 'error'), 'error', 4200);
      return false;
    }
  }
}

/**
 * Debounced autosave (~400ms). Safe to call on every keystroke.
 * @param {object} state
 */
export function saveLocal(state) {
  if (!isObj(state)) return;
  pendingState = state;
  if (saveTimer !== null) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const next = pendingState;
    pendingState = null;
    if (next) saveLocalNow(next);
  }, SAVE_DEBOUNCE_MS);
}

/**
 * Read the autosaved poster back, validated + migrated.
 * @returns {object|null}
 */
export function loadLocal() {
  const store = storage();
  if (!store) return null;
  let text = null;
  try {
    text = store.getItem(STORAGE_KEY);
  } catch (_err) {
    return null;
  }
  if (!text) return null;
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch (_err) {
    return null;
  }
  return migrate(parsed);
}

/** Drop the autosaved poster. */
export function clearLocal() {
  if (saveTimer !== null) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  pendingState = null;
  const store = storage();
  if (!store) return;
  try {
    store.removeItem(STORAGE_KEY);
  } catch (_err) {
    /* nothing else we can do */
  }
}

/* ------------------------------------------------------------------ *
 * Workspace preferences
 *
 * Small bits of "how I like my editor" that are NOT part of the document:
 * they must not travel with an exported poster, must not enter the undo
 * stack, and must survive a Load & Fork. Kept under their own key prefix so
 * clearing the autosave never takes them with it.
 * ------------------------------------------------------------------ */

const PREF_PREFIX = 'poster-studio:pref:';

/**
 * Read a workspace preference.
 * @param {string} key short name, e.g. 'panelWidth'
 * @param {*} [fallback=null] returned when unset, unreadable or corrupt
 * @returns {*}
 */
export function readPref(key, fallback = null) {
  const store = storage();
  if (!store || !key) return fallback;
  try {
    const raw = store.getItem(PREF_PREFIX + key);
    if (raw === null) return fallback;
    return JSON.parse(raw);
  } catch (_err) {
    return fallback;
  }
}

/**
 * Write a workspace preference. Silent on failure — a preference that cannot
 * be stored is a lost convenience, never an error worth interrupting for.
 * @param {string} key short name, e.g. 'panelWidth'
 * @param {*} value any JSON-serializable value
 * @returns {boolean} true when the write succeeded
 */
export function writePref(key, value) {
  const store = storage();
  if (!store || !key) return false;
  try {
    store.setItem(PREF_PREFIX + key, JSON.stringify(value));
    return true;
  } catch (_err) {
    return false;
  }
}

/* ------------------------------------------------------------------ *
 * JSON serialization
 * ------------------------------------------------------------------ */

/**
 * Visit every <Image> object in a state tree (logos + image blocks).
 * @param {object} state @param {(img:object)=>void} fn
 */
function forEachImage(state, fn) {
  if (!isObj(state)) return;
  const header = isObj(state.header) ? state.header : {};
  for (const key of ['logoLeft', 'logoRight']) {
    const slot = header[key];
    if (isObj(slot) && isObj(slot.image)) fn(slot.image);
  }
  const walk = (block) => {
    if (!isObj(block)) return;
    if (block.kind === 'split' && Array.isArray(block.children)) {
      block.children.forEach(walk);
      return;
    }
    if (isObj(block.image)) fn(block.image);
  };
  if (Array.isArray(state.columns)) {
    for (const col of state.columns) {
      if (isObj(col)) walk(col.root);
    }
  }
}

/**
 * Serialize the poster to pretty-printed JSON.
 * Image `path` strings are ALWAYS kept; `dataUrl` payloads are dropped when
 * `embedImages` is false so the file stays small and portable.
 *
 * @param {object} state
 * @param {boolean} [embedImages=true]
 * @returns {string} JSON text (2-space indent)
 */
export function serializeJSON(state, embedImages = true) {
  const copy = deepCopy(isObj(state) ? state : defaultPoster());
  const embed = embedImages !== false;
  if (!embed) {
    forEachImage(copy, (img) => {
      img.dataUrl = null;
      if (typeof img.path !== 'string') img.path = '';
    });
    if (isObj(copy.canvas) && isObj(copy.canvas.background)) {
      copy.canvas.background.imageDataUrl = null;
    }
  }
  const payload = {
    _generator: GENERATOR_NOTE,
    _schemaVersion: SCHEMA_VERSION,
    _exported: new Date().toISOString(),
    _imagesEmbedded: embed,
    meta: copy.meta,
    canvas: copy.canvas,
    style: copy.style,
    header: copy.header,
    columns: copy.columns
  };
  return JSON.stringify(payload, null, 2);
}

/**
 * Download the poster as `<name>.json`.
 * @param {object} state
 * @param {boolean} [embedImages=true]
 */
export function exportJSON(state, embedImages = true) {
  const name = safeFileName(isObj(state) && isObj(state.meta) ? state.meta.name : '');
  download(`${name}.json`, serializeJSON(state, embedImages), 'application/json');
  toast(`Exported ${name}.json`, 'success');
}

/* ------------------------------------------------------------------ *
 * Markdown serialization
 * ------------------------------------------------------------------ */

/** Quote a value for YAML front matter. */
function yamlStr(v) {
  return JSON.stringify(String(v === null || v === undefined ? '' : v));
}

/** Round to at most 4 decimals for readable output. */
function nice(n) {
  const v = num(n, 0);
  return String(Math.round(v * 10000) / 10000);
}

/** Markdown heading marker for a given nesting depth (capped at h6). */
function headingFor(depth) {
  return '#'.repeat(Math.min(6, 3 + Math.max(0, depth)));
}

/** `<!-- block: id | type | ratio | fixedIn -->` */
function blockComment(block) {
  const type = block.kind === 'split' ? `split:${block.orientation}` : block.type;
  const fixed = block.fixedIn === null || block.fixedIn === undefined ? 'auto' : `${nice(block.fixedIn)}in`;
  return `<!-- block: ${block.id} | ${type} | ratio ${nice(block.ratio)} | fixedIn ${fixed} -->`;
}

const MD_IMAGE_RE = /!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+["'][^"']*["'])?\s*\)/g;

/**
 * Collect every image reference in the poster for the export manifest.
 * @param {object} state
 * @returns {Array<{path:string, usages:string[], embedded:boolean}>}
 */
function collectImageManifest(state) {
  /** @type {Map<string, {path:string, usages:string[], embedded:boolean}>} */
  const map = new Map();
  const add = (path, usage, embedded) => {
    const p = typeof path === 'string' ? path.trim() : '';
    if (!p) return;
    const entry = map.get(p) || { path: p, usages: [], embedded: false };
    if (!entry.usages.includes(usage)) entry.usages.push(usage);
    entry.embedded = entry.embedded || Boolean(embedded);
    map.set(p, entry);
  };
  const scanMarkdown = (md, usage) => {
    if (typeof md !== 'string' || !md) return;
    MD_IMAGE_RE.lastIndex = 0;
    let m = MD_IMAGE_RE.exec(md);
    while (m) {
      add(m[2], usage, false);
      m = MD_IMAGE_RE.exec(md);
    }
  };

  const header = isObj(state.header) ? state.header : {};
  if (isObj(header.logoLeft) && isObj(header.logoLeft.image)) {
    add(header.logoLeft.image.path, 'Logo Left', header.logoLeft.image.dataUrl);
  }
  if (isObj(header.logoRight) && isObj(header.logoRight.image)) {
    add(header.logoRight.image.path, 'Logo Right', header.logoRight.image.dataUrl);
  }
  const bg = isObj(state.canvas) && isObj(state.canvas.background) ? state.canvas.background : null;
  if (bg && bg.imagePath) {
    add(bg.imagePath, bg.useImage ? 'Canvas background' : 'Canvas background (off)', bg.imageDataUrl);
  }

  const columns = Array.isArray(state.columns) ? state.columns : [];
  columns.forEach((col, ci) => {
    if (!isObj(col)) return;
    const colLabel = str(col.label, `Column ${ci + 1}`);
    const walk = (block) => {
      if (!isObj(block)) return;
      if (block.kind === 'split' && Array.isArray(block.children)) {
        block.children.forEach(walk);
        return;
      }
      const where = `${colLabel} › ${str(block.label, '') || block.id}`;
      if (block.type === 'image' && isObj(block.image)) {
        add(block.image.path, where, block.image.dataUrl);
        // A caption is Markdown too, so it can carry its own inline images.
        scanMarkdown(block.image.caption, `${where} (in caption)`);
      }
      scanMarkdown(block.markdown, `${where} (in markdown)`);
    };
    walk(col.root);
  });

  return Array.from(map.values());
}

/** Shorten data: URIs so the manifest table stays readable. */
function displayPath(path) {
  if (path.startsWith('data:')) return '`data:` inline payload (no external file)';
  return path;
}

/** Escape pipe characters so a path never breaks the manifest table. */
function tableCell(text) {
  return String(text).replace(/\|/g, '\\|');
}

/**
 * Serialize the poster to a self-describing Markdown archive: YAML front
 * matter, header content, a depth-first walk of every column/block, and an
 * image manifest so a reader knows which files to copy alongside the .md.
 *
 * @param {object} state
 * @returns {string} markdown text
 */
export function serializeMarkdown(state) {
  const s = isObj(state) ? state : defaultPoster();
  const meta = isObj(s.meta) ? s.meta : {};
  const canvas = isObj(s.canvas) ? s.canvas : defaultPoster().canvas;
  const margins = isObj(canvas.margins) ? canvas.margins : { top: 0, right: 0, bottom: 0, left: 0 };
  const header = isObj(s.header) ? s.header : {};
  const columns = Array.isArray(s.columns) ? s.columns : [];
  const out = [];

  // --- YAML front matter -------------------------------------------------
  out.push('---');
  out.push(`name: ${yamlStr(str(meta.name, 'Untitled_Poster'))}`);
  out.push(`schema_version: ${SCHEMA_VERSION}`);
  out.push(`generated: ${yamlStr(new Date().toISOString())}`);
  out.push(`generator: ${yamlStr(GENERATOR_NOTE)}`);
  if (meta.forkedFrom) out.push(`forked_from: ${yamlStr(meta.forkedFrom)}`);
  out.push('canvas:');
  out.push(`  width_in: ${nice(canvas.widthIn)}`);
  out.push(`  height_in: ${nice(canvas.heightIn)}`);
  out.push(`  column_gap_in: ${nice(canvas.columnGapIn)}`);
  out.push(`  row_gap_in: ${nice(canvas.rowGapIn)}`);
  out.push('  margins_in:');
  out.push(`    top: ${nice(margins.top)}`);
  out.push(`    right: ${nice(margins.right)}`);
  out.push(`    bottom: ${nice(margins.bottom)}`);
  out.push(`    left: ${nice(margins.left)}`);
  out.push(`header_height_in: ${nice(header.heightIn)}`);
  out.push('columns:');
  if (columns.length === 0) {
    out.push('  []');
  } else {
    columns.forEach((col, i) => {
      const c = isObj(col) ? col : {};
      out.push(`  - label: ${yamlStr(str(c.label, `Column ${i + 1}`))}`);
      out.push(`    width_in: ${c.widthIn === null || c.widthIn === undefined ? 'auto' : nice(c.widthIn)}`);
    });
  }
  out.push('---');
  out.push('');

  // --- Header ------------------------------------------------------------
  out.push(`# ${str(header.title, 'Untitled Poster').replace(/\s*\n\s*/g, ' ').trim()}`);
  out.push('');
  const authors = str(header.authors, '').trim();
  if (authors) {
    out.push(`**${authors.replace(/\s*\n\s*/g, ' ')}**`);
    out.push('');
  }
  const affiliations = str(header.affiliations, '').trim();
  if (affiliations) {
    for (const line of affiliations.split(/\r?\n/)) {
      const t = line.trim();
      out.push(t ? `*${t}*` : '');
    }
    out.push('');
  }
  const logoLeft = isObj(header.logoLeft) && isObj(header.logoLeft.image) ? header.logoLeft.image : null;
  const logoRight = isObj(header.logoRight) && isObj(header.logoRight.image) ? header.logoRight.image : null;
  if (logoLeft && logoLeft.path) out.push(`![Logo Left](${logoLeft.path})`);
  if (logoRight && logoRight.path) out.push(`![Logo Right](${logoRight.path})`);
  if ((logoLeft && logoLeft.path) || (logoRight && logoRight.path)) out.push('');

  const bg = isObj(canvas.background) ? canvas.background : null;
  if (bg && bg.useImage && bg.imagePath) {
    out.push(`<!-- canvas background: ${bg.imagePath} | fit ${bg.imageFit} | opacity ${nice(bg.imageOpacity)} -->`);
    out.push('');
  }

  out.push('---');
  out.push('');

  // --- Columns and blocks (depth-first) ----------------------------------
  columns.forEach((col, ci) => {
    const c = isObj(col) ? col : {};
    const width = c.widthIn === null || c.widthIn === undefined ? 'auto' : `${nice(c.widthIn)} in`;
    out.push(`## ${str(c.label, `Column ${ci + 1}`)} (${width})`);
    out.push('');

    const walk = (block, depth) => {
      if (!isObj(block)) return;
      out.push(blockComment(block));
      if (block.kind === 'split') {
        const kids = Array.isArray(block.children) ? block.children : [];
        out.push(`<!-- ${block.orientation === 'cols' ? 'side-by-side' : 'stacked'} group of ` +
          `${kids.length} block${kids.length === 1 ? '' : 's'}, gap ${nice(block.gapIn)} in -->`);
        out.push('');
        kids.forEach((kid) => walk(kid, depth + 1));
        return;
      }
      const label = str(block.label, '').trim();
      if (label) {
        out.push(`${headingFor(depth)} ${label}`);
        out.push('');
      }
      if (block.type === 'section') {
        // A band is a heading in every sense, so it exports as one — one level
        // shallower than a normal block's, since it introduces what follows.
        const banner = str(block.markdown, '').trim().replace(/^#{1,6}\s*/, '').split('\n')[0] || 'Section';
        out.push(`${headingFor(Math.max(0, depth - 1))} ${banner}`);
        out.push('');
        return;
      }
      if (block.type === 'image') {
        const img = isObj(block.image) ? block.image : { path: '', alt: '', fit: 'contain' };
        const alt = str(img.alt, '').trim() || label || 'Image';
        const path = str(img.path, '').trim();
        out.push(path ? `![${alt}](${path})` : `*(image block with no path set — alt: ${alt})*`);
        if (img.dataUrl) out.push('');
        if (img.dataUrl) out.push('<!-- an embedded copy of this image is stored in the .json export -->');
        const caption = str(img.caption, '').trim();
        if (caption) {
          out.push('');
          out.push(caption);
        }
        out.push('');
      } else {
        const body = str(block.markdown, '').replace(/\s+$/, '');
        if (body) {
          out.push(body);
          out.push('');
        } else {
          out.push('*(empty)*');
          out.push('');
        }
      }
    };

    walk(c.root, 0);
    out.push('');
  });

  // --- Image manifest ----------------------------------------------------
  out.push('## Image Manifest');
  out.push('');
  const manifest = collectImageManifest(s);
  if (manifest.length === 0) {
    out.push('*No image references in this poster.*');
    out.push('');
  } else {
    out.push('Copy these files next to the Markdown/JSON to keep the poster portable.');
    out.push('');
    out.push('| # | Path | Used by | Embedded copy |');
    out.push('| --- | --- | --- | --- |');
    manifest.forEach((entry, i) => {
      out.push(
        `| ${i + 1} | \`${tableCell(displayPath(entry.path))}\` | ` +
        `${tableCell(entry.usages.join('; '))} | ${entry.embedded ? 'yes' : 'no'} |`
      );
    });
    out.push('');
  }

  out.push(`<!-- ${GENERATOR_NOTE} -->`);
  out.push('');
  return out.join('\n');
}

/**
 * Download the poster as `<name>.md`.
 * @param {object} state
 */
export function exportMarkdown(state) {
  const name = safeFileName(isObj(state) && isObj(state.meta) ? state.meta.name : '');
  download(`${name}.md`, serializeMarkdown(state), 'text/markdown');
  toast(`Exported ${name}.md`, 'success');
}

/* ------------------------------------------------------------------ *
 * File input / download
 * ------------------------------------------------------------------ */

/**
 * Read a File/Blob as a base64 data URL.
 * @param {File|Blob} file
 * @returns {Promise<string>}
 */
export function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    if (!file) {
      reject(new Error('No file was provided.'));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () =>
      reject(new Error(`Could not read “${file.name || 'file'}”. It may be unreadable or too large.`));
    reader.onabort = () => reject(new Error('Reading the file was cancelled.'));
    try {
      reader.readAsDataURL(file);
    } catch (err) {
      reject(new Error(`Could not read “${file.name || 'file'}”: ${err && err.message ? err.message : err}`));
    }
  });
}

/** Read a File/Blob as UTF-8 text. */
function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () =>
      reject(new Error(`Could not read “${file.name || 'file'}”.`));
    reader.onabort = () => reject(new Error('Reading the file was cancelled.'));
    try {
      reader.readAsText(file);
    } catch (err) {
      reject(new Error(`Could not read “${file.name || 'file'}”: ${err && err.message ? err.message : err}`));
    }
  });
}

/**
 * Import a `.json` poster file. The result is always forked into a working
 * copy: `meta.forkedFrom` records the source filename and `meta.name` becomes
 * `forkName(original)` so the original file is never silently overwritten.
 *
 * @param {File} file
 * @returns {Promise<object>} migrated + forked state
 */
export function importJSONFile(file) {
  if (!file) return Promise.reject(new Error('No file selected.'));
  return readFileAsText(file).then((text) => {
    if (!text.trim()) {
      throw new Error(`“${file.name}” is empty — nothing to import.`);
    }
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      const detail = err && err.message ? err.message : 'unknown parse error';
      throw new Error(`“${file.name}” is not valid JSON (${detail}). Export a poster from this app to get a compatible file.`);
    }
    const state = migrate(parsed);
    if (!state) {
      throw new Error(`“${file.name}” does not look like a Poster Studio file — the top level must be a JSON object with a poster in it.`);
    }
    const original = str(isObj(parsed.meta) ? parsed.meta.name : '', '').trim() ||
      String(file.name).replace(/\.json$/i, '') ||
      'Untitled_Poster';
    state.meta.forkedFrom = String(file.name);
    state.meta.name = forkName(original);
    state.meta.modified = new Date().toISOString();
    return state;
  });
}

/**
 * Trigger a browser download of in-memory content.
 * @param {string} filename @param {string|Blob} content @param {string} [mime]
 */
export function download(filename, content, mime = 'text/plain') {
  const blob = content instanceof Blob ? content : new Blob([String(content)], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || 'download';
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  // Revoke after a tick — Safari needs the URL to still be live when it clicks.
  setTimeout(() => {
    if (a.parentNode) a.parentNode.removeChild(a);
    URL.revokeObjectURL(url);
  }, 0);
}

/* ------------------------------------------------------------------ *
 * Toasts
 * ------------------------------------------------------------------ */

/** Get (or lazily create) the toast host element. */
function toastHost() {
  let host = document.getElementById('toast-host');
  if (!host) {
    host = document.createElement('div');
    host.id = 'toast-host';
    host.className = 'toast-host';
    host.setAttribute('role', 'status');
    host.setAttribute('aria-live', 'polite');
    document.body.appendChild(host);
  }
  return host;
}

/** Fade out then detach. */
function dismissToast(el) {
  if (!el || el.dataset.leaving === '1') return;
  el.dataset.leaving = '1';
  el.classList.add('is-leaving');
  setTimeout(() => {
    if (el.parentNode) el.parentNode.removeChild(el);
  }, 220);
}

/**
 * Show a transient message. Never blocks; click to dismiss early.
 * @param {string} message
 * @param {'info'|'success'|'warn'|'error'} [kind='info']
 * @param {number} [ms=2600] auto-dismiss delay in ms (<=0 keeps it until clicked)
 * @returns {HTMLElement|null} the toast element
 */
export function toast(message, kind = 'info', ms = 2600) {
  if (typeof document === 'undefined' || !document.body) return null;
  const host = toastHost();
  const el = document.createElement('div');
  const safeKind = ['info', 'success', 'warn', 'error'].includes(kind) ? kind : 'info';
  el.className = `toast toast--${safeKind}`;
  el.setAttribute('role', safeKind === 'error' ? 'alert' : 'status');
  el.tabIndex = 0;
  el.title = 'Click to dismiss';
  el.textContent = String(message === null || message === undefined ? '' : message);
  el.addEventListener('click', () => dismissToast(el));
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') dismissToast(el);
  });
  host.appendChild(el);

  // Cap the stack: retire the oldest toasts that are not already leaving.
  const live = Array.from(host.children).filter((n) => n.dataset.leaving !== '1');
  for (let i = 0; i < live.length - MAX_TOASTS; i += 1) dismissToast(live[i]);

  const delay = Number.isFinite(ms) ? ms : 2600;
  if (delay > 0) setTimeout(() => dismissToast(el), delay);
  return el;
}

/* ------------------------------------------------------------------ *
 * Images
 * ------------------------------------------------------------------ */

/**
 * Resolve the best usable `src` for an <Image>: the embedded payload wins,
 * otherwise the recorded path.
 * @param {object} image
 * @returns {string} '' when nothing is usable
 */
export function resolveImageSrc(image) {
  if (!isObj(image)) return '';
  const dataUrl = typeof image.dataUrl === 'string' ? image.dataUrl.trim() : '';
  if (dataUrl) return dataUrl;
  const path = typeof image.path === 'string' ? image.path.trim() : '';
  return path;
}

/** Build the neutral "No Image Available" placeholder node. */
function buildMissingNode(pathLabel) {
  const wrap = document.createElement('div');
  wrap.className = 'ps-img-missing';

  const icon = document.createElement('span');
  icon.className = 'ps-img-missing__icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = '🖼';

  const text = document.createElement('span');
  text.className = 'ps-img-missing__text';
  text.textContent = 'No Image Available';

  const code = document.createElement('code');
  code.className = 'ps-img-missing__path';
  code.textContent = pathLabel || '(no path set)';

  wrap.appendChild(icon);
  wrap.appendChild(text);
  wrap.appendChild(code);
  return wrap;
}

/**
 * Render an <Image> into `container`, replacing its contents. A missing src or
 * a load failure (including one that happens after insertion) swaps in the
 * neutral `.ps-img-missing` placeholder, so broken images never break layout.
 *
 * @param {HTMLElement} container element to fill (cleared first)
 * @param {object} image the <Image> object {path,dataUrl,alt,fit}
 * @param {{fit?:string, label?:string}} [opts] fit override and path label
 * @returns {HTMLImageElement|null} the img element, or null when a fallback was rendered
 */
export function mountImage(container, image, opts = {}) {
  if (!container) return null;
  const options = isObj(opts) ? opts : {};
  const img0 = isObj(image) ? image : null;
  const rawPath = img0 && typeof img0.path === 'string' ? img0.path.trim() : '';
  const label = typeof options.label === 'string' && options.label ? options.label : rawPath;

  while (container.firstChild) container.removeChild(container.firstChild);

  const src = resolveImageSrc(img0);
  if (!src) {
    container.appendChild(buildMissingNode(label));
    return null;
  }

  const requestedFit = oneOf(options.fit, IMAGE_FITS, oneOf(img0 && img0.fit, IMAGE_FITS, 'contain'));
  const img = document.createElement('img');
  img.className = 'ps-img';
  img.alt = (img0 && typeof img0.alt === 'string' && img0.alt) ? img0.alt : (label || '');
  img.loading = 'eager';
  img.decoding = 'async';
  img.style.objectFit = requestedFit;

  // Deliberately NOT setting crossOrigin up front. It would turn every typed URL
  // into a CORS request, and most university and lab pages serve images without
  // an Access-Control-Allow-Origin header — those would all fail and fall back to
  // the placeholder, defeating half of the dual image input. Instead: load
  // normally first, and only retry as a CORS request if that fails. A successful
  // CORS load additionally leaves the canvas untainted for html2canvas.
  let retriedWithCors = false;

  img.addEventListener('error', () => {
    if (!retriedWithCors && /^https?:\/\//i.test(src)) {
      retriedWithCors = true;
      img.crossOrigin = 'anonymous';
      img.src = src;
      return;
    }
    const fallback = buildMissingNode(label || src);
    const parent = img.parentNode;
    if (parent) {
      parent.replaceChild(fallback, img);
    } else if (!container.firstChild) {
      // The img was swapped out by a re-render; only fill an empty container.
      container.appendChild(fallback);
    }
  });

  container.appendChild(img);
  img.src = src;
  return img;
}
