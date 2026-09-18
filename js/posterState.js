/**
 * posterState.js — the single reactive store for Interactive Poster Studio
 * plus all pure tree-mutation helpers.
 *
 * No DOM access, no component imports. Only ./data.js may be imported here so the
 * store stays testable and free of rendering concerns.
 *
 * All measurements are in INCHES; rendering converts with a pixels-per-inch value.
 */

import {
  BLOCK_TYPES,
  createColumn,
  createImage,
  createLeaf,
  createSplit,
  defaultPoster
} from './data.js';

/** Maximum number of undo entries retained. */
const HISTORY_LIMIT = 60;

/** Smallest width (inches) any column may resolve to. */
const MIN_COLUMN_IN = 0.5;

/** Allowed column count range. */
const MIN_COLUMNS = 1;
const MAX_COLUMNS = 6;

/* ------------------------------------------------------------------ *
 * Internal utilities
 * ------------------------------------------------------------------ */

/**
 * Deep clone that prefers structuredClone and falls back to JSON round-tripping
 * (older Safari / file:// contexts without structuredClone).
 * @param {*} value
 * @returns {*}
 */
function deepClone(value) {
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(value);
    } catch (err) {
      // Non-cloneable member (should not happen for plain state) — fall through.
      console.error('structuredClone failed, falling back to JSON clone', err);
    }
  }
  return JSON.parse(JSON.stringify(value));
}

/**
 * @param {number} n
 * @param {number} lo
 * @param {number} hi
 * @returns {number}
 */
function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

/** Trim float noise so exported inch values stay readable. */
function round4(n) {
  return Math.round(n * 10000) / 10000;
}

/** True when v is a usable finite number. */
function isNum(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

/** Coerce anything to a finite number, else fallback. */
function num(v, fallback) {
  const n = typeof v === 'string' ? parseFloat(v) : v;
  return isNum(n) ? n : fallback;
}

/* ------------------------------------------------------------------ *
 * Store internals
 * ------------------------------------------------------------------ */

/** @type {object} */
let state = defaultPoster();

/** Non-persisted UI state (live object — consumers may read it directly). */
const ui = {
  selectedId: null,
  zoom: 0.2,
  panelCollapsed: false,
  panelWidth: 0,
  exportDpi: 150,
  embedImages: true,
  /**
   * Where the current selection came from: 'canvas' when the user clicked the
   * poster, 'panel' when they used the sidebar, null once handled.
   *
   * The sidebar reads this to decide whether to scroll itself to the matching
   * inspector — and clears it in place (no notify) so the reaction fires once
   * and a panel-originated selection never bounces the panel around under the
   * user's own cursor.
   */
  focusSource: null
};

/** @type {object[]} snapshots of states BEFORE each committed change */
let undoStack = [];
/** @type {object[]} snapshots produced by undo() */
let redoStack = [];

/** @type {Set<Function>} */
const subscribers = new Set();

let dirty = false;

/**
 * Snapshot taken at the start of a burst of `{silent:true}` updates (slider drags).
 * It is pushed to history as ONE entry when the burst ends, which is how successive
 * silent updates coalesce instead of flooding the undo stack.
 * @type {object|null}
 */
let silentBase = null;

/**
 * Push a pre-change snapshot onto the undo stack and invalidate redo.
 * @param {object} snapshot
 */
function pushHistory(snapshot) {
  undoStack.push(snapshot);
  if (undoStack.length > HISTORY_LIMIT) {
    undoStack = undoStack.slice(undoStack.length - HISTORY_LIMIT);
  }
  redoStack = [];
}

/**
 * Realise a pending coalesced silent burst as a single undo entry.
 * Called before undo() and before any non-silent commit.
 */
function flushSilent() {
  if (silentBase) {
    pushHistory(silentBase);
    silentBase = null;
  }
}

/**
 * Record history for a commit according to `meta`.
 * @param {object} prevSnapshot state as it was before the commit
 * @param {{silent?:boolean}} meta
 */
function recordHistory(prevSnapshot, meta) {
  if (meta && meta.silent) {
    // Do not grow the stack per drag tick; remember where the burst started.
    if (!silentBase) silentBase = prevSnapshot;
    // A new edit invalidates any redo future, exactly as a normal commit does.
    // Without this, dragging a slider after an undo would leave a stale redo
    // entry that discards the drag when replayed.
    redoStack = [];
    return;
  }
  if (silentBase) {
    // The burst ended: one entry for the whole drag, then one for this change.
    pushHistory(silentBase);
    silentBase = null;
  }
  pushHistory(prevSnapshot);
}

/**
 * Notify every subscriber. A throwing subscriber is logged and skipped so it can
 * never take down the rest of the app.
 * @param {object} nextState
 * @param {object} meta
 */
function notify(nextState, meta) {
  const listeners = Array.from(subscribers);
  for (const fn of listeners) {
    try {
      fn(nextState, meta);
    } catch (err) {
      console.error('posterState subscriber failed', err);
    }
  }
}

/* ------------------------------------------------------------------ *
 * Public store
 * ------------------------------------------------------------------ */

export const posterState = {
  /** Live UI state (not persisted, not part of history). */
  ui,

  /**
   * @returns {object} the current poster state. Treat as read-only; mutate through update().
   */
  get() {
    return state;
  },

  /**
   * Replace the entire state (import, reset, load from storage). Pushes history.
   * Does NOT bump meta.modified — loading an existing design is not an edit.
   *
   * Pass `{initial: true}` for the very first load. The store is constructed with
   * a throwaway `defaultPoster()`; without this flag that blank poster becomes
   * undoStack[0], so the user's first Ctrl+Z would replace their restored
   * autosave with an empty sheet — which the save subscriber would then persist.
   *
   * @param {object} nextState full poster state
   * @param {object} [meta] notify metadata (see contract §3)
   * @returns {object} the state now held by the store
   */
  set(nextState, meta = {}) {
    if (!nextState || typeof nextState !== 'object') {
      console.error('posterState.set called with a non-object', nextState);
      return state;
    }
    const prev = state;
    state = deepClone(nextState);
    if (meta.initial) {
      undoStack = [];
      redoStack = [];
      silentBase = null;
    } else {
      recordHistory(prev, meta);
      dirty = true;
    }
    notify(state, Object.assign({ structural: true, replaced: true }, meta));
    return state;
  },

  /**
   * Commit a change. The mutator receives a deep clone of the current state and
   * mutates it freely; the clone becomes the new state.
   * @param {(draft:object)=>*} mutator
   * @param {object} [meta] {source,silent,structural,...} — passed to subscribers
   * @returns {*} whatever the mutator returned (e.g. the id from splitBlock)
   */
  update(mutator, meta = {}) {
    if (typeof mutator !== 'function') {
      console.error('posterState.update requires a function');
      return undefined;
    }
    const draft = deepClone(state);
    let result;
    try {
      result = mutator(draft);
    } catch (err) {
      // Abort the commit entirely: the live state is untouched.
      console.error('posterState.update mutator threw; change discarded', err);
      return undefined;
    }
    if (draft.meta && typeof draft.meta === 'object') {
      draft.meta.modified = new Date().toISOString();
    }
    const prev = state;
    state = draft;
    recordHistory(prev, meta);
    dirty = true;
    notify(state, meta);
    return result;
  },

  /**
   * Merge a patch into the live ui object and notify with {uiOnly:true}.
   * Never touches history and never marks the document dirty.
   * @param {Partial<typeof ui>} patch
   * @returns {typeof ui} the live ui object
   */
  setUI(patch) {
    if (patch && typeof patch === 'object') {
      Object.assign(ui, patch);
      if ('zoom' in patch) ui.zoom = clamp(num(ui.zoom, 0.2), 0.05, 2);
    }
    notify(state, { uiOnly: true });
    return ui;
  },

  /**
   * Register a listener called as fn(state, meta) after every commit.
   * @param {(state:object, meta:object)=>void} fn
   * @returns {() => void} unsubscribe
   */
  subscribe(fn) {
    if (typeof fn !== 'function') return () => {};
    subscribers.add(fn);
    return () => {
      subscribers.delete(fn);
    };
  },

  /**
   * Step one commit back.
   * @returns {boolean} true when the state changed
   */
  undo() {
    flushSilent();
    if (!undoStack.length) return false;
    const prev = undoStack.pop();
    redoStack.push(state);
    if (redoStack.length > HISTORY_LIMIT) {
      redoStack = redoStack.slice(redoStack.length - HISTORY_LIMIT);
    }
    state = prev;
    dirty = true;
    notify(state, { structural: true, source: 'history', undo: true });
    return true;
  },

  /**
   * Re-apply the most recently undone commit.
   * @returns {boolean} true when the state changed
   */
  redo() {
    if (!redoStack.length) return false;
    const next = redoStack.pop();
    undoStack.push(state);
    if (undoStack.length > HISTORY_LIMIT) {
      undoStack = undoStack.slice(undoStack.length - HISTORY_LIMIT);
    }
    state = next;
    dirty = true;
    notify(state, { structural: true, source: 'history', redo: true });
    return true;
  },

  /** @returns {boolean} */
  canUndo() {
    return undoStack.length > 0 || silentBase !== null;
  },

  /** @returns {boolean} */
  canRedo() {
    return redoStack.length > 0;
  },

  /** Mark the current state as persisted. Does not notify. */
  markSaved() {
    dirty = false;
  },

  /** @returns {boolean} true when there are unsaved changes */
  isDirty() {
    return dirty;
  }
};

/* ------------------------------------------------------------------ *
 * Tree helpers (pure — they operate on whatever state/draft is passed in)
 * ------------------------------------------------------------------ */

/**
 * Locate a block anywhere in the column tree.
 * @param {object} state poster state or draft
 * @param {string} id block id
 * @returns {{block:object, parent:object|null, column:object, index:number}|null}
 *   `parent` is null for a column root, in which case `index` is -1.
 */
export function findBlock(state, id) {
  if (!state || !id || !Array.isArray(state.columns)) return null;

  /**
   * @param {object} block
   * @param {object|null} parent
   * @param {object} column
   * @param {number} index
   */
  const walk = (block, parent, column, index) => {
    if (!block) return null;
    if (block.id === id) return { block, parent, column, index };
    if (block.kind === 'split' && Array.isArray(block.children)) {
      for (let i = 0; i < block.children.length; i += 1) {
        const hit = walk(block.children[i], block, column, i);
        if (hit) return hit;
      }
    }
    return null;
  };

  for (const column of state.columns) {
    if (!column) continue;
    const hit = walk(column.root, null, column, -1);
    if (hit) return hit;
  }
  return null;
}

/**
 * Depth-first pre-order traversal of every block in every column.
 * @param {object} state poster state or draft
 * @param {(block:object, parent:object|null, column:object, depth:number)=>void} fn
 */
export function visitBlocks(state, fn) {
  if (!state || typeof fn !== 'function' || !Array.isArray(state.columns)) return;

  const walk = (block, parent, column, depth) => {
    if (!block) return;
    fn(block, parent, column, depth);
    if (block.kind === 'split' && Array.isArray(block.children)) {
      for (const child of block.children) walk(child, block, column, depth + 1);
    }
  };

  for (const column of state.columns) {
    if (column) walk(column.root, null, column, 0);
  }
}

/**
 * Put `next` into the slot currently occupied by the block described by `info`.
 * @param {{parent:object|null, column:object, index:number}} info
 * @param {object} next
 */
function replaceSlot(info, next) {
  if (info.parent && Array.isArray(info.parent.children) && info.index >= 0) {
    info.parent.children[info.index] = next;
  } else if (info.column) {
    info.column.root = next;
  }
}

/**
 * Split a block, adding one fresh markdown leaf beside it.
 *
 * - leaf → becomes a split; the original leaf is the first child (id preserved,
 *   ratio reset to 1) and inherits nothing; the new split takes over the leaf's
 *   ratio/fixedIn slot.
 * - split with the SAME orientation → simply append another leaf child.
 * - split with the OPPOSITE orientation → wrapped in a new split of the requested
 *   orientation, alongside the new leaf.
 *
 * @param {object} state draft state (mutated)
 * @param {string} id block id to split
 * @param {'rows'|'cols'} orientation
 * @returns {string|null} the new child's id, or null when `id` was not found
 */
export function splitBlock(state, id, orientation) {
  const dir = orientation === 'cols' ? 'cols' : 'rows';
  const info = findBlock(state, id);
  if (!info) return null;

  const target = info.block;
  const leaf = createLeaf({ label: 'New Section' });

  if (target.kind === 'split' && target.orientation === dir) {
    if (!Array.isArray(target.children)) target.children = [];
    target.children.push(leaf);
    return leaf.id;
  }

  // Leaf, or a split whose orientation differs: wrap the target in a new split.
  const gapIn = isNum(target.gapIn) ? target.gapIn : 0.25;
  const wrapper = createSplit(dir, [target, leaf], gapIn);
  wrapper.ratio = isNum(target.ratio) ? target.ratio : 1;
  wrapper.fixedIn = isNum(target.fixedIn) ? target.fixedIn : null;

  // The wrapped child now shares the wrapper evenly and loses its own fixed size.
  target.ratio = 1;
  target.fixedIn = null;

  replaceSlot(info, wrapper);
  return leaf.id;
}

/**
 * Remove a block from the tree. Removing a column root is refused (a column always
 * needs content). When the parent split is left holding a single child, the parent
 * collapses: the survivor takes the parent's slot, ratio and fixedIn.
 *
 * @param {object} state draft state (mutated)
 * @param {string} id block id to remove
 * @returns {boolean} true when something was removed
 */
export function removeBlock(state, id) {
  const info = findBlock(state, id);
  if (!info) return false;
  if (!info.parent) return false; // column root — nothing to remove it from

  const parent = info.parent;
  if (!Array.isArray(parent.children) || info.index < 0) return false;
  parent.children.splice(info.index, 1);

  if (parent.children.length === 1) {
    const survivor = parent.children[0];
    survivor.ratio = isNum(parent.ratio) ? parent.ratio : 1;
    survivor.fixedIn = isNum(parent.fixedIn) ? parent.fixedIn : null;
    const parentInfo = findBlock(state, parent.id);
    if (parentInfo) replaceSlot(parentInfo, survivor);
  } else if (parent.children.length === 0) {
    // Defensive: splits always hold >= 2 children, but never leave an empty one.
    const parentInfo = findBlock(state, parent.id);
    if (parentInfo && parentInfo.parent) {
      removeBlock(state, parent.id);
    } else if (parentInfo) {
      replaceSlot(parentInfo, createLeaf({ label: 'New Section' }));
    }
  }
  return true;
}

/**
 * Switch a leaf between markdown, image and section-header, creating whatever
 * payload the new type needs. Splits are ignored.
 *
 * `markdown` carries the banner text for a section header, so switching to and
 * from one reuses the field rather than inventing a parallel one. Coming back
 * out of a section header the one-line banner is a poor body, so it is promoted
 * to a heading instead of being left as a stray sentence.
 *
 * @param {object} state draft state (mutated)
 * @param {string} id leaf block id
 * @param {'markdown'|'image'|'section'} type
 * @returns {boolean} true when the type changed
 */
export function setBlockType(state, id, type) {
  const next = BLOCK_TYPES.includes(type) ? type : 'markdown';
  const info = findBlock(state, id);
  if (!info || info.block.kind !== 'leaf') return false;

  const block = info.block;
  const prev = block.type;
  if (prev === next) return false;
  block.type = next;

  if (next === 'image') {
    if (!block.image || typeof block.image !== 'object') {
      block.image = createImage('./assets/placeholders/no-image.svg', {
        alt: block.label || 'Figure'
      });
    }
    if (typeof block.markdown !== 'string') block.markdown = '';
    return true;
  }

  if (next === 'section') {
    // A banner is one line. Prefer the block's own heading, then the first
    // meaningful line of whatever prose was there, then a neutral placeholder.
    block.markdown = firstMeaningfulLine(block.label) ||
      firstMeaningfulLine(block.markdown) ||
      'Section';
    block.label = '';
    return true;
  }

  if (prev === 'section') {
    const banner = firstMeaningfulLine(block.markdown) || 'New Section';
    block.label = banner;
    block.markdown = `Write your content here.`;
    return true;
  }

  if (typeof block.markdown !== 'string' || !block.markdown.trim()) {
    block.markdown = '### ' + (block.label || 'New Section') + '\n\nWrite your content here.';
  }
  return true;
}

/** First non-empty line of a string, stripped of leading Markdown heading marks. */
function firstMeaningfulLine(value) {
  if (typeof value !== 'string') return '';
  for (const line of value.split('\n')) {
    const trimmed = line.replace(/^\s*#{1,6}\s*/, '').trim();
    if (trimmed) return trimmed;
  }
  return '';
}

/**
 * Grow or shrink the top-level column list, keeping existing columns intact.
 * New columns are auto-width and start with one markdown leaf.
 * @param {object} state draft state (mutated)
 * @param {number} n desired count, clamped to 1..6
 * @returns {number} the resulting column count
 */
export function setColumnCount(state, n) {
  if (!state) return 0;
  if (!Array.isArray(state.columns)) state.columns = [];
  const target = clamp(Math.round(num(n, state.columns.length)), MIN_COLUMNS, MAX_COLUMNS);

  while (state.columns.length > target) state.columns.pop();

  while (state.columns.length < target) {
    const index = state.columns.length;
    const root = createLeaf({
      label: 'New Section',
      markdown: '### New Section\n\nAdd your content for this column here.'
    });
    // null width = auto: the new column shares whatever space is left over.
    state.columns.push(createColumn('Column ' + (index + 1), null, root));
  }
  return state.columns.length;
}

/**
 * Reorder a block among its siblings.
 * @param {object} state draft state (mutated)
 * @param {string} id block id
 * @param {number} delta -1 (earlier) or +1 (later)
 * @returns {boolean} true when the block moved
 */
export function moveBlock(state, id, delta) {
  const step = num(delta, 0);
  if (!step) return false;
  const info = findBlock(state, id);
  if (!info || !info.parent || !Array.isArray(info.parent.children)) return false;

  const children = info.parent.children;
  const from = info.index;
  const to = from + (step > 0 ? 1 : -1);
  if (from < 0 || to < 0 || to >= children.length) return false;

  const [moved] = children.splice(from, 1);
  children.splice(to, 0, moved);
  return true;
}

/**
 * Resolve every column's width in inches. Fixed widths win (clamped to the space
 * that actually exists); auto columns share the remainder equally. If the fixed
 * widths cannot fit, they are scaled down proportionally so the row always fits.
 * @param {object} state poster state or draft
 * @returns {number[]} widths in inches, in column order
 */
export function computeColumnWidths(state) {
  const columns = state && Array.isArray(state.columns) ? state.columns : [];
  const n = columns.length;
  if (!n) return [];

  const canvas = (state && state.canvas) || {};
  const margins = canvas.margins || {};
  const gapIn = Math.max(0, num(canvas.columnGapIn, 0));
  const totalGap = gapIn * (n - 1);
  const raw =
    num(canvas.widthIn, 48) - num(margins.left, 0) - num(margins.right, 0) - totalGap;

  // Never go non-positive: degenerate page settings must still produce usable widths.
  const available = Math.max(raw, n * MIN_COLUMN_IN);

  const fixed = new Array(n).fill(null);
  let autoCount = 0;
  let fixedTotal = 0;

  for (let i = 0; i < n; i += 1) {
    const w = columns[i] ? columns[i].widthIn : null;
    if (isNum(w) && w > 0) {
      const v = clamp(w, MIN_COLUMN_IN, available);
      fixed[i] = v;
      fixedTotal += v;
    } else {
      autoCount += 1;
    }
  }

  const reserved = autoCount * MIN_COLUMN_IN;
  const fixedBudget = available - reserved;

  if (fixedTotal > fixedBudget) {
    if (fixedBudget <= 0) {
      // Not even the minimums fit — fall back to an even split.
      return columns.map(() => round4(available / n));
    }
    const scale = fixedBudget / fixedTotal;
    for (let i = 0; i < n; i += 1) {
      if (fixed[i] !== null) fixed[i] = fixed[i] * scale;
    }
    fixedTotal = fixedBudget;
  }

  const leftover = Math.max(0, available - fixedTotal);
  const autoWidth = autoCount ? Math.max(MIN_COLUMN_IN, leftover / autoCount) : 0;

  return columns.map((col, i) => round4(fixed[i] === null ? autoWidth : fixed[i]));
}

/**
 * Printable area inside the page margins.
 * @param {object} state poster state or draft
 * @returns {{width:number, height:number}} inches
 */
export function contentBoxIn(state) {
  const canvas = (state && state.canvas) || {};
  const margins = canvas.margins || {};
  const width = num(canvas.widthIn, 48) - num(margins.left, 0) - num(margins.right, 0);
  const height = num(canvas.heightIn, 36) - num(margins.top, 0) - num(margins.bottom, 0);
  return { width: round4(Math.max(0, width)), height: round4(Math.max(0, height)) };
}
