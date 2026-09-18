/**
 * chrome.js — how much of the app you can see.
 *
 * On a 13" laptop the top bar plus a 340px control panel leaves very little
 * room for the thing being designed. This module owns three levers:
 *
 *   1. The control panel has three widths: `full`, `rail` (icons only) and
 *      `hidden`. The top-bar button cycles them and Ctrl/Cmd+\ does the same
 *      from the keyboard. The choice is a workspace preference, not part of the
 *      document, so it is persisted next to the panel width.
 *   2. The top bar is marked `data-chrome-region` in index.html, which hands
 *      Ctrl/Cmd+Shift+H to the shared theme switcher for free.
 *   3. Focus mode does both at once and puts a single fixed "Exit focus" button
 *      on screen — the only control guaranteed not to be hidden by either.
 *
 * The rail is generated from whatever sections leftPanel.js built, so adding a
 * panel section automatically adds a rail button. Only the glyph is hardcoded,
 * and an unknown section falls back to a dot rather than disappearing.
 */

import { posterState } from '../posterState.js';
import { readPref, writePref } from '../storage.js';

/** Panel widths, in cycle order. */
const MODES = ['full', 'rail', 'hidden'];

/** Persisted under `poster-studio:pref:panelMode`, beside `panelWidth`. */
const PREF_KEY = 'panelMode';

/**
 * One glyph per panel section id (see the `section(..., {id})` calls in
 * leftPanel.js). Geometric-shape characters rather than an icon font or SVG
 * sprite: the app has no build step and these render identically everywhere.
 */
const SECTION_GLYPHS = {
  project: '▣',
  canvas: '▭',
  header: 'T',
  style: '◐',
  columns: '▥',
  tree: '⌗',
  inspector: '◎',
  guide: '?'
};

let mode = 'full';
let focusMode = false;

/** Panel mode to restore when focus mode ends. */
let modeBeforeFocus = 'full';

/* ------------------------------------------------------------------ *
 * Panel mode
 * ------------------------------------------------------------------ */

function normalizeMode(value) {
  return MODES.includes(value) ? value : 'full';
}

/**
 * Read the persisted mode, falling back to the older boolean preference.
 *
 * Before the rail existed the panel was a two-state thing mirrored on
 * `posterState.ui.panelCollapsed`. Anyone upgrading with a collapsed panel
 * should stay collapsed rather than have it spring open.
 */
function initialMode() {
  const stored = readPref(PREF_KEY, null);
  if (typeof stored === 'string') return normalizeMode(stored);
  return posterState.ui.panelCollapsed ? 'hidden' : 'full';
}

export function getPanelMode() {
  return mode;
}

export function isFocusMode() {
  return focusMode;
}

/* ------------------------------------------------------------------ *
 * Mount
 * ------------------------------------------------------------------ */

/**
 * Wire the chrome controls. Call after leftPanel.js has mounted, because the
 * rail is generated from the sections it created.
 *
 * @param {{
 *   toggleButton?: HTMLElement|null,
 *   focusButton?: HTMLElement|null,
 *   focusExitButton?: HTMLElement|null,
 *   panel?: HTMLElement|null,
 *   rail?: HTMLElement|null,
 *   onLayoutChange?: () => void
 * }} refs
 */
export function mountChrome(refs = {}) {
  const {
    toggleButton = null,
    focusButton = null,
    focusExitButton = null,
    panel = null,
    rail = null,
    onLayoutChange = null
  } = refs;

  if (rail && panel) buildRail(rail, panel, () => setMode('full'));

  mode = initialMode();

  function announce() {
    // The stage's usable width changes with the panel, and the poster is
    // usually zoomed to fit it. app.js passes a re-fit here.
    if (typeof onLayoutChange === 'function') onLayoutChange();
  }

  function paint() {
    const body = document.body;
    body.dataset.panelMode = mode;
    // Kept for the pre-existing rule in layout.css and for anything else that
    // still asks the simple question "is the panel out of the way?".
    body.classList.toggle('panel-collapsed', mode !== 'full');
    body.classList.toggle('focus-mode', focusMode);

    if (rail) rail.hidden = mode !== 'rail';

    if (toggleButton) {
      toggleButton.setAttribute('aria-expanded', String(mode === 'full'));
      toggleButton.dataset.panelMode = mode;
      toggleButton.title = `Controls panel: ${mode} — click for ${nextMode(mode)} (Ctrl/Cmd+\\)`;
    }
    if (focusButton) focusButton.setAttribute('aria-pressed', String(focusMode));
    if (focusExitButton) focusExitButton.hidden = !focusMode;

    // Mirrored so existing consumers of the store keep working; written
    // directly because this is workspace state, not a document edit, and
    // setUI() would notify every subscriber twice per toggle.
    posterState.ui.panelCollapsed = mode !== 'full';
  }

  function setMode(next, { persist = true } = {}) {
    const value = normalizeMode(next);
    if (value === mode) return;
    mode = value;
    if (persist) writePref(PREF_KEY, mode);
    paint();
    announce();
  }

  function cycle() {
    setMode(nextMode(mode));
  }

  /* --- focus mode --- */

  function setFocus(on) {
    if (on === focusMode) return;
    focusMode = on;

    if (on) {
      modeBeforeFocus = mode;
      // Not persisted: focus mode is a moment, not a preference, and coming
      // back to a chrome-less app after a reload is disorienting.
      setMode('hidden', { persist: false });
      setChromeRegions('hidden');
      paint();
      if (focusExitButton) focusExitButton.focus();
    } else {
      setChromeRegions('visible');
      setMode(modeBeforeFocus, { persist: false });
      paint();
      if (focusButton) focusButton.focus();
    }
    announce();
  }

  /* --- wiring --- */

  if (toggleButton) toggleButton.addEventListener('click', cycle);
  if (focusButton) focusButton.addEventListener('click', () => setFocus(!focusMode));
  if (focusExitButton) focusExitButton.addEventListener('click', () => setFocus(false));

  window.addEventListener('keydown', (event) => {
    const mod = event.metaKey || event.ctrlKey;
    if (mod && !event.altKey && event.key === '\\') {
      event.preventDefault();
      cycle();
      return;
    }
    if (mod && event.shiftKey && event.key.toLowerCase() === 'f') {
      event.preventDefault();
      setFocus(!focusMode);
      return;
    }
    if (event.key === 'Escape' && focusMode) {
      // Only leave focus mode when nothing more local wants the key — a caret
      // in a block is closer to the user's attention than the chrome is.
      const active = document.activeElement;
      if (active && (active.isContentEditable || active.tagName === 'TEXTAREA')) return;
      setFocus(false);
    }
  });

  // The shared switcher can restore the chrome behind our back (Cmd/Ctrl+Shift+H
  // or Escape). Focus mode claims "everything is hidden", so it has to stand
  // down when that stops being true.
  window.addEventListener('appsuite:themechange', (event) => {
    const detail = event.detail || {};
    if (focusMode && detail.chrome === 'visible') {
      focusMode = false;
      setMode(modeBeforeFocus, { persist: false });
      paint();
      announce();
    }
  });

  paint();

  return { setMode, cycle, setFocus, getMode: () => mode };
}

function nextMode(current) {
  return MODES[(MODES.indexOf(current) + 1) % MODES.length];
}

/**
 * Hide or show every [data-chrome-region] through the shared API when it is
 * present, and by hand when it is not — the app has to keep working if
 * shared/theme-switcher.js fails to load.
 * @param {'hidden'|'visible'} value
 */
function setChromeRegions(value) {
  const api = window.AppSuiteTheme;
  if (api && typeof api.setChrome === 'function') {
    api.setChrome(value);
    return;
  }
  const hidden = value === 'hidden';
  document.documentElement.setAttribute('data-chrome', value);
  for (const region of document.querySelectorAll('[data-chrome-region]')) {
    region.classList.toggle('chrome-hidden', hidden);
    if (hidden) region.setAttribute('aria-hidden', 'true');
    else region.removeAttribute('aria-hidden');
  }
}

/* ------------------------------------------------------------------ *
 * The icon rail
 * ------------------------------------------------------------------ */

/**
 * Build one button per panel section. Clicking it reopens the panel at that
 * section, so the rail is a shortcut rather than a dead-end: nothing in the
 * sidebar becomes unreachable while it is collapsed.
 *
 * @param {HTMLElement} rail
 * @param {HTMLElement} panel
 * @param {() => void} expand switches the panel back to its full width
 */
function buildRail(rail, panel, expand) {
  rail.textContent = '';

  const sections = panel.querySelectorAll('details[data-section]');
  for (const details of sections) {
    const id = details.dataset.section;
    const titleNode = details.querySelector('.panel-section__title');
    const label = titleNode ? titleNode.textContent.trim() : id;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'panel-rail__btn';
    btn.textContent = SECTION_GLYPHS[id] || '·';
    btn.title = label;
    btn.setAttribute('aria-label', `Open ${label}`);
    btn.dataset.section = id;

    btn.addEventListener('click', () => {
      expand();
      details.open = true;
      // After the panel re-appears, put the caret-equivalent where the user
      // asked to go rather than at the top of a long sidebar.
      window.requestAnimationFrame(() => {
        const summary = details.querySelector('summary');
        if (summary) {
          summary.focus();
          details.scrollIntoView({ block: 'nearest' });
        }
      });
    });

    rail.appendChild(btn);
  }
}
