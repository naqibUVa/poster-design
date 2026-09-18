/**
 * panelResizer.js — the drag handle between the controls panel and the stage.
 *
 * Owns exactly one thing: the width of `#left-panel`. It publishes that width
 * by writing the `--psui-panel-w` custom property on `<html>`, which is the
 * single token `.left-panel` sizes itself from — so nothing else in the app has
 * to know a resize happened.
 *
 * Why a custom property rather than an inline `style.width`: the panel's
 * `width`, `min-width` and `max-width` all read the same token, and all three
 * have to move together or the flex row simply refuses to give up the pixels.
 *
 * The chosen width is a workspace preference, not part of the poster: it is
 * persisted through `storage.writePref` and never enters the document, the
 * undo stack or an export.
 */

import { posterState } from '../posterState.js';
import { readPref, writePref } from '../storage.js';

/** Narrowest useful panel — below this the two-up field rows start to collide. */
export const PANEL_MIN = 260;

/** Widest the panel may get, unless the window is too small to allow it. */
export const PANEL_MAX = 900;

/** Stage width we always leave visible, so the poster never disappears. */
const STAGE_RESERVE = 280;

/** Matches `--psui-panel-w` in controls.css; the double-click reset target. */
export const PANEL_DEFAULT = 340;

/** Keyboard nudge, and its Shift-accelerated version, in px. */
const STEP = 16;
const STEP_FAST = 64;

/** Preference key under storage.js's own prefix. */
const PREF_KEY = 'panelWidth';

/**
 * The largest width we will allow right now.
 *
 * Depends on the viewport, so it is recomputed on every use rather than cached:
 * a panel dragged wide on a large display must fold back down when the same
 * session is later resized small, instead of pushing the stage off-screen.
 */
function maxWidth() {
  const room = (window.innerWidth || 1280) - STAGE_RESERVE;
  return Math.max(PANEL_MIN, Math.min(PANEL_MAX, room));
}

function clampWidth(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return PANEL_DEFAULT;
  return Math.round(Math.max(PANEL_MIN, Math.min(maxWidth(), n)));
}

/**
 * Wire up the separator.
 *
 * @param {HTMLElement} handleEl the `#panel-resizer` element
 * @param {HTMLElement} panelEl the `#left-panel` aside
 * @param {{onResize?: (width:number)=>void}} [opts]
 *   `onResize` fires after a drag settles or a keyboard nudge, never on every
 *   pointermove — it is meant for expensive follow-up work such as re-fitting
 *   the zoom, and dragging must stay smooth.
 * @returns {{get: () => number, set: (w:number, opts?:{persist?:boolean}) => number}}
 */
export function mountPanelResizer(handleEl, panelEl, opts = {}) {
  if (!handleEl || !panelEl) throw new Error('mountPanelResizer requires a handle and a panel');
  const onResize = typeof opts.onResize === 'function' ? opts.onResize : () => {};

  let width = clampWidth(readPref(PREF_KEY, PANEL_DEFAULT));

  const publish = (next, { persist = false } = {}) => {
    width = clampWidth(next);
    document.documentElement.style.setProperty('--psui-panel-w', `${width}px`);
    handleEl.setAttribute('aria-valuenow', String(width));
    handleEl.setAttribute('aria-valuemin', String(PANEL_MIN));
    handleEl.setAttribute('aria-valuemax', String(maxWidth()));
    handleEl.setAttribute('aria-valuetext', `Controls panel ${width} pixels wide`);
    // Mirrored into the store so other components can read the current width
    // without measuring the DOM. Assigned directly, not via setUI: this is not
    // a state change anyone needs to re-render for, and a notify on every
    // pointermove would re-render the whole poster.
    posterState.ui.panelWidth = width;
    if (persist) writePref(PREF_KEY, width);
    return width;
  };

  publish(width);

  /* --- pointer drag ---------------------------------------------------- */

  let dragFrom = 0;
  let dragWidth = 0;
  let pointerId = null;

  handleEl.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    event.preventDefault();
    pointerId = event.pointerId;
    dragFrom = event.clientX;
    dragWidth = width;
    handleEl.setPointerCapture(pointerId);
    handleEl.classList.add('is-dragging');
    // Without this the drag selects text across the whole page the moment the
    // pointer leaves the 6px handle.
    document.body.classList.add('is-resizing-panel');
  });

  handleEl.addEventListener('pointermove', (event) => {
    if (pointerId === null || event.pointerId !== pointerId) return;
    publish(dragWidth + (event.clientX - dragFrom));
  });

  const endDrag = (event) => {
    if (pointerId === null || (event && event.pointerId !== pointerId)) return;
    try {
      handleEl.releasePointerCapture(pointerId);
    } catch (_err) {
      /* the capture is already gone; nothing to release */
    }
    pointerId = null;
    handleEl.classList.remove('is-dragging');
    document.body.classList.remove('is-resizing-panel');
    publish(width, { persist: true });
    onResize(width);
  };

  handleEl.addEventListener('pointerup', endDrag);
  handleEl.addEventListener('pointercancel', endDrag);

  /* --- double-click resets --------------------------------------------- */

  handleEl.addEventListener('dblclick', () => {
    publish(PANEL_DEFAULT, { persist: true });
    onResize(width);
  });

  /* --- keyboard --------------------------------------------------------- */

  handleEl.addEventListener('keydown', (event) => {
    const step = event.shiftKey ? STEP_FAST : STEP;
    let next = null;
    if (event.key === 'ArrowLeft') next = width - step;
    else if (event.key === 'ArrowRight') next = width + step;
    else if (event.key === 'Home') next = PANEL_MIN;
    else if (event.key === 'End') next = maxWidth();
    else if (event.key === 'Enter' || event.key === ' ') next = PANEL_DEFAULT;
    if (next === null) return;

    event.preventDefault();
    // Arrow keys inside the panel would otherwise also scroll it.
    event.stopPropagation();
    publish(next, { persist: true });
    onResize(width);
  });

  /* --- viewport ---------------------------------------------------------- */

  let settle = null;
  window.addEventListener('resize', () => {
    clearTimeout(settle);
    settle = setTimeout(() => {
      const before = width;
      // Re-clamping against the new viewport: persist nothing, so shrinking the
      // window temporarily does not overwrite the width the user chose.
      publish(width);
      if (width !== before) onResize(width);
    }, 120);
  });

  return {
    get: () => width,
    set: (value, options) => {
      const next = publish(value, options);
      onResize(next);
      return next;
    }
  };
}
