/**
 * app.js — application entry point.
 *
 * Boots the store from the browser's autosave, mounts the two components, wires
 * the top bar and the keyboard, and keeps the save indicator honest. Everything
 * is wrapped so a failure shows a readable banner rather than a blank white page.
 */

import { posterState, findBlock, removeBlock } from './posterState.js';
import { defaultPoster } from './data.js';
import {
  loadLocal,
  saveLocal,
  saveLocalNow,
  exportJSON,
  exportMarkdown,
  forkName,
  toast
} from './storage.js';
import { mountLeftPanel } from './components/leftPanel.js';
import { mountPanelResizer } from './components/panelResizer.js';
import { mountCanvas, PPI_BASE } from './components/canvas.js';
import { mountTemplatePicker } from './components/templatePicker.js';
import { mountTutorialModal } from './components/tutorialModal.js';
import { mountChrome } from './components/chrome.js';
import { exportPDF, printPoster } from './pdfExporter.js';

const ZOOM_MIN = 0.05;
const ZOOM_MAX = 2;
const ZOOM_STEPS = [0.05, 0.08, 0.1, 0.15, 0.2, 0.25, 0.33, 0.5, 0.67, 0.8, 1, 1.25, 1.5, 2];

/* ------------------------------------------------------------------ *
 * Boot
 * ------------------------------------------------------------------ */

function boot() {
  const stage = document.getElementById('stage');
  const panel = document.getElementById('left-panel');
  if (!stage || !panel) throw new Error('The page is missing #stage or #left-panel');

  // Restoring the autosave must not become the first entry in the undo stack —
  // otherwise the user's first Ctrl+Z would wipe their poster.
  const restored = loadLocal();
  posterState.set(restored || defaultPoster(), { initial: true, structural: true, replaced: true });

  // A restored design is already a working fork; make that visible in its name
  // only when it came from an imported file that had not been forked yet.
  if (restored && restored.meta && restored.meta.forkedFrom &&
      restored.meta.name === restored.meta.forkedFrom.replace(/\.json$/i, '')) {
    posterState.update((draft) => { draft.meta.name = forkName(draft.meta.name); }, { silent: true });
  }

  mountLeftPanel(panel);
  mountCanvas(stage);

  const resizer = document.getElementById('panel-resizer');
  if (resizer) {
    mountPanelResizer(resizer, panel, {
      // Widening the panel narrows the stage. Chase the new fit only while the
      // poster was already zoomed to fit, so a deliberate zoom level survives.
      onResize: () => {
        const fit = fitZoom();
        if (Math.abs(posterState.ui.zoom - fit) < 0.08) posterState.setUI({ zoom: fit });
      }
    });
  }

  // Mounted after the panel, because the rail mirrors the sections it built.
  mountChrome({
    toggleButton: document.getElementById('toggle-panel'),
    focusButton: document.getElementById('btn-focus'),
    focusExitButton: document.getElementById('focus-exit'),
    panel,
    rail: document.getElementById('panel-rail'),
    // Collapsing the panel widens the stage; chase the new fit on the same
    // terms as a window resize, so a deliberate zoom level is left alone.
    onLayoutChange: () => {
      window.setTimeout(() => {
        const fit = fitZoom();
        if (Math.abs(posterState.ui.zoom - fit) < 0.08) posterState.setUI({ zoom: fit });
      }, 220);
    }
  });

  mountTemplatePicker(document.getElementById('btn-templates'), {
    // A template almost always changes the sheet size, so the old zoom is
    // meaningless — show the whole new poster.
    onApply: () => posterState.setUI({ zoom: fitZoom() })
  });

  mountTutorialModal(document.getElementById('btn-tutorial'));
  mountTutorialModal(document.getElementById('topbar-tutorial-btn'));

  wireAutosave();
  wireTopBar();
  wireKeyboard();
  wireResize();

  // Start at a zoom that shows the whole sheet.
  posterState.setUI({ zoom: fitZoom() });

  window.PosterStudio = {
    posterState,
    exportPDF,
    printPoster,
    exportJSON,
    exportMarkdown,
    saveLocalNow,
    fitZoom,
    version: 1
  };

  if (restored) {
    toast('Restored your working copy from this browser', 'info');
  }
}

/* ------------------------------------------------------------------ *
 * Autosave + status indicator
 * ------------------------------------------------------------------ */

function wireAutosave() {
  const status = document.getElementById('save-status');
  let settleTimer = null;

  const setStatus = (text, cls) => {
    if (!status) return;
    status.textContent = text;
    status.classList.remove('is-saving', 'is-saved', 'is-dirty', 'is-error');
    if (cls) status.classList.add(cls);
  };

  setStatus('Ready', 'is-saved');

  posterState.subscribe((state, meta) => {
    if (meta && meta.uiOnly) return;

    saveLocal(state);
    setStatus('Saving…', 'is-saving');

    // storage.saveLocal debounces internally; wait past that before claiming success.
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => {
      posterState.markSaved();
      const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      setStatus(`All changes saved · ${time}`, 'is-saved');
    }, 700);
  });

  // Write the working copy once at boot. The subscriber above only fires on a
  // change, so without this a fork that is opened and closed without edits
  // never reaches localStorage and there is nothing to restore next time.
  saveLocalNow(posterState.get());
  posterState.markSaved();

  window.addEventListener('beforeunload', () => {
    saveLocalNow(posterState.get());
  });

  // Mobile Safari and backgrounded tabs never fire beforeunload reliably.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') saveLocalNow(posterState.get());
  });
}

/* ------------------------------------------------------------------ *
 * Zoom
 * ------------------------------------------------------------------ */

/** Largest zoom at which the whole sheet fits the stage, with breathing room. */
function fitZoom() {
  const stage = document.getElementById('stage');
  const state = posterState.get();
  if (!stage || !state) return 0.2;

  const pad = 64;
  const availableW = Math.max(120, stage.clientWidth - pad);
  const availableH = Math.max(120, stage.clientHeight - pad);
  const value = Math.min(
    availableW / (state.canvas.widthIn * PPI_BASE),
    availableH / (state.canvas.heightIn * PPI_BASE)
  );
  return clampZoom(Number(value.toFixed(3)));
}

function clampZoom(value) {
  return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, value));
}

/** Step to the next preset stop in `direction` (+1 in, -1 out). */
function stepZoom(direction) {
  const current = posterState.ui.zoom;
  if (direction > 0) {
    const next = ZOOM_STEPS.find((z) => z > current + 0.0005);
    posterState.setUI({ zoom: clampZoom(next === undefined ? ZOOM_MAX : next) });
  } else {
    const candidates = ZOOM_STEPS.filter((z) => z < current - 0.0005);
    const next = candidates.length ? candidates[candidates.length - 1] : ZOOM_MIN;
    posterState.setUI({ zoom: clampZoom(next) });
  }
}

/* ------------------------------------------------------------------ *
 * Top bar
 * ------------------------------------------------------------------ */

function on(id, event, handler) {
  const node = document.getElementById(id);
  if (node) node.addEventListener(event, handler);
  return node;
}

function wireTopBar() {
  // #toggle-panel and #btn-focus belong to chrome.js, which owns the panel mode
  // and the focus-mode state; wiring them here too would double-toggle them.

  on('zoom-out', 'click', () => stepZoom(-1));
  on('zoom-in', 'click', () => stepZoom(1));
  on('zoom-fit', 'click', () => posterState.setUI({ zoom: fitZoom() }));

  const zoomLevel = document.getElementById('zoom-level');
  if (zoomLevel) {
    // Clicking the read-out returns to 100% — a familiar affordance from map UIs.
    zoomLevel.addEventListener('click', () => posterState.setUI({ zoom: 1 }));
    zoomLevel.title = 'Click for 100%';
    zoomLevel.style.cursor = 'pointer';
  }

  const undoBtn = on('btn-undo', 'click', () => posterState.undo());
  const redoBtn = on('btn-redo', 'click', () => posterState.redo());

  on('btn-export-json', 'click', () => exportJSON(posterState.get(), !!posterState.ui.embedImages));
  on('btn-export-md', 'click', () => exportMarkdown(posterState.get()));
  on('btn-print', 'click', () => printPoster(posterState.get()));

  const pdfBtn = on('btn-export-pdf', 'click', () => {
    if (!pdfBtn) return;
    // The rail button's face is a fixed glyph, so progress goes to the tooltip
    // and the busy class rather than replacing its contents.
    const original = pdfBtn.dataset.tip || 'Export PDF';
    pdfBtn.disabled = true;
    pdfBtn.classList.add('is-busy');
    exportPDF(posterState.get(), {
      dpi: posterState.ui.exportDpi || 150,
      onProgress: (message) => {
        pdfBtn.dataset.tip = message || original;
        pdfBtn.title = message || original;
      }
    }).finally(() => {
      pdfBtn.disabled = false;
      pdfBtn.classList.remove('is-busy');
      pdfBtn.dataset.tip = original;
      pdfBtn.title = 'Render the poster to a raster PDF at the selected DPI';
    });
  });

  const refresh = () => {
    if (zoomLevel) zoomLevel.textContent = `${Math.round(posterState.ui.zoom * 100)}%`;
    if (undoBtn) undoBtn.disabled = !posterState.canUndo();
    if (redoBtn) redoBtn.disabled = !posterState.canRedo();
  };

  posterState.subscribe(refresh);
  refresh();
}

/* ------------------------------------------------------------------ *
 * Keyboard
 * ------------------------------------------------------------------ */

/** True when the keystroke belongs to whatever the user is typing into. */
function inTextEntry(target) {
  if (!target) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

function wireKeyboard() {
  window.addEventListener('keydown', (event) => {
    const mod = event.metaKey || event.ctrlKey;
    const typing = inTextEntry(event.target);

    if (mod) {
      const key = event.key.toLowerCase();
      if (key === 's') {
        event.preventDefault();
        exportJSON(posterState.get(), !!posterState.ui.embedImages);
        return;
      }
      if (key === 'p') {
        event.preventDefault();
        printPoster(posterState.get());
        return;
      }
      if (key === 'z') {
        // Let the browser handle undo inside a text field the user is editing.
        if (typing) return;
        event.preventDefault();
        if (event.shiftKey) posterState.redo();
        else posterState.undo();
        return;
      }
      if (key === 'y') {
        if (typing) return;
        event.preventDefault();
        posterState.redo();
        return;
      }
      if (key === '0') {
        event.preventDefault();
        posterState.setUI({ zoom: fitZoom() });
        return;
      }
      if (key === '=' || key === '+') { event.preventDefault(); stepZoom(1); return; }
      if (key === '-' || key === '_') { event.preventDefault(); stepZoom(-1); return; }
      return;
    }

    if (typing) return;

    if (event.key === 'Escape') {
      posterState.setUI({ selectedId: null });
      return;
    }

    if (event.key === 'Delete' || event.key === 'Backspace') {
      const id = posterState.ui.selectedId;
      if (!id || String(id).startsWith('header.')) return;
      const hit = findBlock(posterState.get(), id);
      if (!hit) return;
      if (!hit.parent) {
        toast('A column’s outermost block cannot be deleted — change the column count instead', 'warn');
        return;
      }
      event.preventDefault();
      posterState.update((draft) => removeBlock(draft, id), { structural: true });
      posterState.setUI({ selectedId: null });
      return;
    }

    if (event.key === '+' || event.key === '=') { stepZoom(1); return; }
    if (event.key === '-' || event.key === '_') { stepZoom(-1); }
  });
}

/* ------------------------------------------------------------------ *
 * Viewport
 * ------------------------------------------------------------------ */

function wireResize() {
  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    // Only chase the viewport while the poster is still zoomed to fit, so a
    // deliberate zoom level is never overridden by a window resize.
    resizeTimer = setTimeout(() => {
      const fit = fitZoom();
      if (Math.abs(posterState.ui.zoom - fit) < 0.08) posterState.setUI({ zoom: fit });
    }, 180);
  });
}

/* ------------------------------------------------------------------ *
 * Error surface
 * ------------------------------------------------------------------ */

function showBootError(error) {
  console.error('Poster Studio failed to start', error);
  const banner = document.getElementById('boot-error');
  const detail = document.getElementById('boot-error-detail');
  if (detail) {
    detail.textContent = String((error && error.stack) || error || 'Unknown error');
  }
  if (banner) {
    banner.hidden = false;
    banner.removeAttribute('hidden');
  } else {
    // Last resort: the banner markup is missing too.
    document.body.textContent = `Poster Studio failed to start: ${error}`;
  }
}

try {
  boot();
} catch (error) {
  showBootError(error);
}
