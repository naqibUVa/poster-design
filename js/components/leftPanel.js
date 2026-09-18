/**
 * leftPanel.js — the tracker + styling sidebar.
 *
 * Rebuild discipline matters here more than anywhere else in the app. The panel's
 * DOM is built exactly once; every notify calls `sync()`, which writes current
 * values into existing controls and skips whichever control has focus. Only three
 * regions are ever rebuilt — the column list, the document tree and the block
 * inspector — and only when their structural signature actually changes. Without
 * that, dragging a slider would destroy the slider under the user's finger.
 */

import {
  posterState,
  findBlock,
  splitBlock,
  removeBlock,
  setBlockType,
  setColumnCount,
  moveBlock,
  computeColumnWidths,
  contentBoxIn
} from '../posterState.js';
import {
  FONT_STACKS,
  THEME_PRESETS,
  MARKDOWN_PLACEHOLDER,
  defaultPoster,
  defaultStyle,
  uid
} from '../data.js';
import {
  exportJSON,
  exportMarkdown,
  importJSONFile,
  readFileAsDataURL,
  clearLocal,
  toast
} from '../storage.js';
import { exportPDF, printPoster } from '../pdfExporter.js';
import { scrollToBlock } from './canvas.js';

/** Sync callbacks registered by every bound control. */
let syncers = [];

/**
 * The region currently being rebuilt. New syncers are tagged with it so the next
 * rebuild of that region can drop them; otherwise the list would grow without
 * bound and keep writing into detached nodes.
 */
let currentOwner = null;

/** Rebuildable regions, keyed by their last structural signature. */
const regions = {
  columns: { el: null, sig: null },
  tree: { el: null, sig: null },
  inspector: { el: null, sig: null }
};

/* ------------------------------------------------------------------ *
 * Tiny DOM builders
 * ------------------------------------------------------------------ */

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

function append(parent, ...children) {
  for (const child of children) {
    if (child) parent.appendChild(child);
  }
  return parent;
}

/** `<details class="panel-section">` with a sticky summary. */
function section(title, { open = false, id } = {}) {
  const details = el('details', 'panel-section');
  details.open = open;
  if (id) details.dataset.section = id;
  const summary = el('summary', 'panel-section__summary');
  append(summary, el('span', 'panel-section__title', title));
  details.appendChild(summary);
  const body = el('div', 'panel-section__body');
  details.appendChild(body);
  details.body = body;
  return details;
}

function group(title) {
  const wrap = el('div', 'panel-group');
  if (title) wrap.appendChild(el('h4', 'panel-group__title', title));
  return wrap;
}

function fieldRow(cols, ...children) {
  const row = el('div', `field-row field-row--${cols}`);
  return append(row, ...children);
}

function button(label, { variant = '', title, onClick, id } = {}) {
  const btn = el('button', `btn${variant ? ` btn--${variant}` : ''}`, label);
  btn.type = 'button';
  if (title) btn.title = title;
  if (id) btn.id = id;
  if (onClick) btn.addEventListener('click', onClick);
  return btn;
}

function iconButton(glyph, { title, onClick, variant = '' } = {}) {
  const btn = el('button', `icon-btn icon-btn--sm${variant ? ` icon-btn--${variant}` : ''}`, glyph);
  btn.type = 'button';
  if (title) {
    btn.title = title;
    btn.setAttribute('aria-label', title);
  }
  if (onClick) btn.addEventListener('click', onClick);
  return btn;
}

function hint(text) {
  return el('p', 'field__hint', text);
}

/** Wrap a control in a labelled `.field`. */
function field(labelText, control, hintText) {
  const wrap = el('div', 'field');
  if (labelText) {
    const label = el('label', 'field__label', labelText);
    label.htmlFor = control.id || (control.id = uid('ctl'));
    wrap.appendChild(label);
  }
  wrap.appendChild(control);
  if (hintText) wrap.appendChild(hint(hintText));
  return wrap;
}

/** A `.field__control` flex row: control plus trailing buttons. */
function controlRow(...children) {
  return append(el('div', 'field__control'), ...children);
}

function register(fn) {
  if (currentOwner) fn.owner = currentOwner;
  syncers.push(fn);
  return fn;
}

/** True when the user is currently typing into this control. */
function busy(node) {
  return document.activeElement === node;
}

const s = () => posterState.get();

function nOr(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** Trim trailing zeros so 12.00 shows as "12". */
function fmt(value, digits = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  return String(Number(n.toFixed(digits)));
}

/* ------------------------------------------------------------------ *
 * Bound control factories
 * ------------------------------------------------------------------ */

/**
 * Number input bound to state.
 * @param {object} cfg get/set plus input attributes; `allowBlank` maps '' to null.
 */
function numberInput(cfg) {
  const input = el('input');
  input.type = 'number';
  if (cfg.min !== undefined) input.min = String(cfg.min);
  if (cfg.max !== undefined) input.max = String(cfg.max);
  input.step = String(cfg.step === undefined ? 0.1 : cfg.step);
  if (cfg.placeholder) input.placeholder = cfg.placeholder;

  register(() => {
    if (busy(input)) return;
    const value = cfg.get(s());
    input.value = value === null || value === undefined ? '' : fmt(value, cfg.digits === undefined ? 3 : cfg.digits);
  });

  const commit = () => {
    const raw = input.value.trim();
    if (raw === '') {
      if (!cfg.allowBlank) { sync(); return; }
      posterState.update((draft) => cfg.set(draft, null));
      return;
    }
    let value = Number(raw);
    if (!Number.isFinite(value)) { sync(); return; }
    if (cfg.min !== undefined) value = Math.max(cfg.min, value);
    if (cfg.max !== undefined) value = Math.min(cfg.max, value);
    posterState.update((draft) => cfg.set(draft, value));
  };

  input.addEventListener('change', commit);
  input.addEventListener('blur', commit);
  return input;
}

function textInput(cfg) {
  const input = el('input');
  input.type = cfg.type || 'text';
  if (cfg.placeholder) input.placeholder = cfg.placeholder;
  if (cfg.mono) input.classList.add('mono');

  register(() => {
    if (busy(input)) return;
    input.value = cfg.get(s()) ?? '';
  });

  input.addEventListener('input', () => {
    posterState.update((draft) => cfg.set(draft, input.value), { source: 'inline' });
  });
  input.addEventListener('change', () => {
    posterState.update((draft) => cfg.set(draft, input.value));
  });
  return input;
}

function textareaInput(cfg) {
  const area = el('textarea');
  area.rows = cfg.rows || 4;
  if (cfg.mono) area.classList.add('textarea--code');
  if (cfg.tall) area.classList.add('textarea--tall');
  if (cfg.placeholder) area.placeholder = cfg.placeholder;
  area.spellcheck = cfg.spellcheck !== false;

  register(() => {
    if (busy(area)) return;
    area.value = cfg.get(s()) ?? '';
  });

  area.addEventListener('input', () => {
    posterState.update((draft) => cfg.set(draft, area.value), { source: 'inline' });
  });
  area.addEventListener('change', () => {
    posterState.update((draft) => cfg.set(draft, area.value));
  });
  return area;
}

function selectInput(cfg) {
  const sel = el('select');
  for (const opt of cfg.options) {
    const option = el('option', null, opt.label);
    option.value = opt.value;
    sel.appendChild(option);
  }
  register(() => {
    if (busy(sel)) return;
    const value = cfg.get(s());
    sel.value = value === null || value === undefined ? '' : String(value);
  });
  sel.addEventListener('change', () => {
    posterState.update((draft) => cfg.set(draft, sel.value), { structural: !!cfg.structural });
  });
  return sel;
}

function checkboxRow(labelText, cfg) {
  const row = el('div', 'check-row');
  const input = el('input');
  input.type = 'checkbox';
  input.id = uid('chk');
  const label = el('label', null, labelText);
  label.htmlFor = input.id;

  register(() => {
    if (busy(input)) return;
    input.checked = !!cfg.get(s());
  });
  input.addEventListener('change', () => {
    posterState.update((draft) => cfg.set(draft, input.checked), { structural: !!cfg.structural });
  });

  return append(row, input, label);
}

/**
 * Slider with a live read-out. Drags commit `{silent:true}` so a single drag is
 * one undo step, then a normal commit lands on release.
 */
function rangeField(labelText, cfg) {
  const wrap = el('div', 'field');
  const input = el('input');
  input.type = 'range';
  input.min = String(cfg.min);
  input.max = String(cfg.max);
  input.step = String(cfg.step);
  input.id = uid('rng');

  const label = el('label', 'field__label', labelText);
  label.htmlFor = input.id;

  const readout = el('span', 'range-row__value');
  const row = append(el('div', 'range-row'), input, readout);

  const show = (value) => { readout.textContent = cfg.format ? cfg.format(value) : fmt(value); };

  register(() => {
    const value = nOr(cfg.get(s()), cfg.min);
    if (!busy(input)) input.value = String(value);
    show(value);
  });

  input.addEventListener('input', () => {
    const value = Number(input.value);
    show(value);
    posterState.update((draft) => cfg.set(draft, value), { silent: true });
  });
  input.addEventListener('change', () => {
    posterState.update((draft) => cfg.set(draft, Number(input.value)));
  });

  return append(wrap, label, row);
}

/** Colour swatch + hex text box, optionally with a reset-to-inherit button. */
function colorField(labelText, cfg) {
  const wrap = el('div', 'field');
  const picker = el('input');
  picker.type = 'color';
  picker.id = uid('col');

  const hex = el('input');
  hex.type = 'text';
  hex.classList.add('mono');
  hex.placeholder = cfg.placeholder || '#000000';
  hex.setAttribute('aria-label', `${labelText} hex value`);

  const label = el('label', 'field__label', labelText);
  label.htmlFor = picker.id;

  const box = append(el('div', 'color-field'), picker, hex);

  if (cfg.onReset) {
    box.appendChild(iconButton('↺', {
      title: 'Reset to the global value',
      onClick: () => { cfg.onReset(); }
    }));
  } else {
    box.appendChild(el('span'));
  }

  register(() => {
    const value = cfg.get(s());
    const normalised = normaliseHex(value);
    if (!busy(picker)) picker.value = normalised || (cfg.inherited ? normaliseHex(cfg.inherited()) || '#ffffff' : '#ffffff');
    if (!busy(hex)) hex.value = value === null || value === undefined ? '' : String(value);
    picker.classList.toggle('is-disabled', false);
  });

  picker.addEventListener('input', () => {
    posterState.update((draft) => cfg.set(draft, picker.value), { silent: true });
  });
  picker.addEventListener('change', () => {
    posterState.update((draft) => cfg.set(draft, picker.value));
  });
  hex.addEventListener('change', () => {
    const raw = hex.value.trim();
    if (raw === '' && cfg.onReset) { cfg.onReset(); return; }
    posterState.update((draft) => cfg.set(draft, raw));
  });

  return append(wrap, label, box);
}

/** Accept `#abc`, `#aabbcc`; anything else returns null so the picker keeps its value. */
function normaliseHex(value) {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  if (/^#[0-9a-f]{6}$/i.test(v)) return v.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(v)) {
    return `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`.toLowerCase();
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * File picking
 * ------------------------------------------------------------------ */

/**
 * Reuse the single hidden `<input type=file>` for every Browse button.
 * @param {string} accept
 * @param {(file: File) => void} handler
 */
function pickFile(accept, handler) {
  const input = document.getElementById('hidden-file');
  if (!input) {
    toast('File picker is unavailable in this page', 'error');
    return;
  }
  input.value = '';
  input.accept = accept;
  const onChange = () => {
    input.removeEventListener('change', onChange);
    const file = input.files && input.files[0];
    if (file) handler(file);
    input.value = '';
  };
  input.addEventListener('change', onChange);
  input.click();
}

/**
 * Read an uploaded image and write it into the state.
 * `path` is only auto-filled when empty, so a deliberate portable path survives.
 * @param {File} file
 * @param {(draft: object) => object|null} locate returns the <Image> inside the draft
 */
function uploadImageInto(file, locate) {
  readFileAsDataURL(file)
    .then((dataUrl) => {
      posterState.update((draft) => {
        const image = locate(draft);
        if (!image) return;
        image.dataUrl = dataUrl;
        if (!image.path) image.path = `./assets/${file.name}`;
        if (!image.alt) image.alt = file.name.replace(/\.[^.]+$/, '');
      });
      toast(`Embedded ${file.name}`, 'success');
    })
    .catch((err) => {
      console.error(err);
      toast(`Could not read ${file.name}`, 'error');
    });
}

/** Path + Browse + Clear, the standard image row used in three places. */
function imagePathRow(labelText, locate, { hintText } = {}) {
  const input = textInput({
    mono: true,
    placeholder: './assets/my_chart.png  or  https://…',
    get: (state) => {
      const image = locate(state);
      return image ? image.path : '';
    },
    set: (draft, value) => {
      const image = locate(draft);
      if (image) image.path = value;
    }
  });

  const browse = button('Browse…', {
    variant: 'ghost',
    title: 'Upload an image file and embed it in this design',
    onClick: () => pickFile('image/*', (file) => uploadImageInto(file, locate))
  });

  const clear = iconButton('✕', {
    title: 'Clear this image',
    variant: 'danger',
    onClick: () => posterState.update((draft) => {
      const image = locate(draft);
      if (!image) return;
      image.path = '';
      image.dataUrl = null;
    })
  });

  const wrap = field(labelText, controlRow(input, browse, clear),
    hintText || 'Type a relative path, an absolute path, or a URL. Browse also embeds the file so the design travels on its own.');

  // A small note telling the user whether a copy is embedded.
  const status = el('p', 'field__hint');
  register(() => {
    const image = locate(s());
    status.textContent = image && image.dataUrl
      ? '● Embedded copy stored — the path is still recorded for portability.'
      : '○ Referenced by path only.';
  });
  wrap.appendChild(status);
  return wrap;
}

/* ------------------------------------------------------------------ *
 * Structural signatures
 * ------------------------------------------------------------------ */

function columnsSignature(state) {
  return state.columns.map((c) => `${c.id}:${c.widthIn === null ? 'auto' : c.widthIn}`).join('|');
}

function walkTree(block, depth, out) {
  out.push(`${block.id}:${block.kind}:${block.type || block.orientation}:${blockDisplayLabel(block)}:${depth}`);
  if (block.kind === 'split') {
    for (const child of block.children) walkTree(child, depth + 1, out);
  }
}

function treeSignature(state) {
  const parts = [];
  for (const column of state.columns) {
    parts.push(`COL:${column.id}:${column.label}`);
    walkTree(column.root, 1, parts);
  }
  return `${posterState.ui.selectedId || ''}#${parts.join('|')}`;
}

function inspectorSignature(state) {
  const id = posterState.ui.selectedId;
  if (!id) return 'empty';
  if (String(id).startsWith('header.')) return `field:${id}`;
  const hit = findBlock(state, id);
  if (!hit) return 'missing';
  const kind = hit.block.kind === 'split' ? `split:${hit.block.orientation}` : `leaf:${hit.block.type}`;
  return `${id}:${kind}:${hit.parent ? hit.parent.orientation : 'root'}`;
}

/* ------------------------------------------------------------------ *
 * Section 1 — Project
 * ------------------------------------------------------------------ */

function buildProjectSection() {
  const sec = section('Project', { open: true, id: 'project' });
  const body = sec.body;

  body.appendChild(field('Design name', textInput({
    placeholder: 'My_Poster',
    get: (state) => state.meta.name,
    set: (draft, value) => { draft.meta.name = value.trim() || 'Untitled_Poster'; }
  }), 'Used for every exported filename.'));

  const origin = el('p', 'panel-note');
  register(() => {
    const meta = s().meta;
    origin.textContent = meta.forkedFrom
      ? `Forked from ${meta.forkedFrom} — the original file is untouched.`
      : 'Working copy auto-saves to this browser as you edit.';
  });
  body.appendChild(origin);

  const undoBtn = button('↶ Undo', { variant: 'ghost', onClick: () => posterState.undo() });
  const redoBtn = button('↷ Redo', { variant: 'ghost', onClick: () => posterState.redo() });
  register(() => {
    undoBtn.disabled = !posterState.canUndo();
    redoBtn.disabled = !posterState.canRedo();
  });
  body.appendChild(append(el('div', 'btn-group btn-group--grow'), undoBtn, redoBtn));

  const files = group('Files');
  append(files,
    append(el('div', 'btn-group btn-group--grow'),
      button('Import JSON…', {
        variant: 'ghost',
        title: 'Load a saved design — it opens as a forked working copy',
        onClick: () => pickFile('application/json,.json', (file) => {
          importJSONFile(file)
            .then((state) => {
              posterState.set(state, { structural: true, replaced: true });
              posterState.setUI({ selectedId: null });
              toast(`Loaded and forked as “${state.meta.name}”`, 'success');
            })
            .catch((err) => {
              console.error(err);
              toast(err && err.message ? err.message : 'That file could not be read as a poster', 'error');
            });
        })
      }),
      button('Export JSON', { variant: 'primary', onClick: () => exportJSON(s(), !!posterState.ui.embedImages) }),
      button('Export Markdown', { variant: 'ghost', onClick: () => exportMarkdown(s()) })
    )
  );
  body.appendChild(files);

  const pdf = group('Print & PDF');
  append(pdf,
    fieldRow(2,
      field('Raster DPI', uiSelect({
        options: [
          { label: '96 — draft', value: '96' },
          { label: '150 — good', value: '150' },
          { label: '300 — print', value: '300' }
        ],
        get: () => String(posterState.ui.exportDpi),
        set: (value) => posterState.setUI({ exportDpi: Number(value) })
      })),
      embedImagesField()
    )
  );

  const pdfBtn = button('Export PDF (raster)', {
    variant: 'primary',
    onClick: () => {
      pdfBtn.disabled = true;
      const original = pdfBtn.textContent;
      exportPDF(s(), {
        dpi: nOr(posterState.ui.exportDpi, 150),
        onProgress: (message) => { pdfBtn.textContent = message || original; }
      }).finally(() => {
        pdfBtn.disabled = false;
        pdfBtn.textContent = original;
      });
    }
  });

  append(pdf,
    pdfBtn,
    button('Print / Save as PDF (vector)', {
      variant: 'ghost',
      title: 'Sharpest text — uses the browser print dialog',
      onClick: () => printPoster(s())
    }),
    hint('Vector printing keeps text crisp at any size. Raster export is more faithful to on-screen effects but is limited by browser canvas size.')
  );
  body.appendChild(pdf);

  const danger = group('Danger zone');
  append(danger, button('Reset to the default template', {
    variant: 'danger',
    onClick: () => {
      const ok = window.confirm(
        'Discard this design and start again from the default template?\n\n' +
        'This cannot be undone with Ctrl+Z. Export a JSON copy first if you want to keep it.'
      );
      if (!ok) return;
      clearLocal();
      posterState.set(defaultPoster(), { structural: true, replaced: true });
      posterState.setUI({ selectedId: null });
      toast('Reset to the default template', 'info');
    }
  }));
  body.appendChild(danger);

  return sec;
}

/** Export settings live on `posterState.ui`, not in the saved state. */
function uiSelect(cfg) {
  const sel = el('select');
  for (const opt of cfg.options) {
    const option = el('option', null, opt.label);
    option.value = opt.value;
    sel.appendChild(option);
  }
  register(() => {
    if (!busy(sel)) sel.value = String(cfg.get());
  });
  sel.addEventListener('change', () => cfg.set(sel.value));
  return sel;
}

function embedImagesField() {
  const wrap = el('div', 'field');
  const input = el('input');
  input.type = 'checkbox';
  input.id = uid('chk');
  const label = el('label', null, 'Embed images in JSON');
  label.htmlFor = input.id;

  register(() => {
    if (!busy(input)) input.checked = !!posterState.ui.embedImages;
  });
  input.addEventListener('change', () => posterState.setUI({ embedImages: input.checked }));

  return append(wrap,
    el('span', 'field__label field__label--muted', 'Portability'),
    append(el('div', 'check-row'), input, label));
}

/* ------------------------------------------------------------------ *
 * Section 2 — Canvas & Page
 * ------------------------------------------------------------------ */

function buildCanvasSection() {
  const sec = section('Canvas & Page', { id: 'canvas' });
  const body = sec.body;

  body.appendChild(fieldRow(2,
    field('Width (in)', numberInput({
      min: 4, max: 200, step: 0.5,
      get: (state) => state.canvas.widthIn,
      set: (draft, v) => { draft.canvas.widthIn = v; }
    })),
    field('Height (in)', numberInput({
      min: 4, max: 200, step: 0.5,
      get: (state) => state.canvas.heightIn,
      set: (draft, v) => { draft.canvas.heightIn = v; }
    }))
  ));

  const sizeNote = el('p', 'field__hint');
  register(() => {
    const c = s().canvas;
    const box = contentBoxIn(s());
    sizeNote.textContent =
      `${fmt(c.widthIn)} × ${fmt(c.heightIn)} in · printable area ${fmt(box.width)} × ${fmt(box.height)} in`;
  });
  body.appendChild(sizeNote);

  const presets = append(el('div', 'swatch-row'),
    ...[
      ['48 × 36', 48, 36],
      ['42 × 30', 42, 30],
      ['A0 landscape', 46.81, 33.11],
      ['A0 portrait', 33.11, 46.81],
      ['36 × 24', 36, 24]
    ].map(([label, w, h]) => {
      const chip = el('button', 'chip', label);
      chip.type = 'button';
      chip.addEventListener('click', () => posterState.update((draft) => {
        draft.canvas.widthIn = w;
        draft.canvas.heightIn = h;
      }));
      return chip;
    })
  );
  body.appendChild(presets);

  const margins = group('Margins (in)');
  append(margins, fieldRow(4,
    field('Top', marginInput('top')),
    field('Right', marginInput('right')),
    field('Bottom', marginInput('bottom')),
    field('Left', marginInput('left'))
  ));
  append(margins, fieldRow(2,
    field('Column gap', numberInput({
      min: 0, max: 6, step: 0.05,
      get: (state) => state.canvas.columnGapIn,
      set: (draft, v) => { draft.canvas.columnGapIn = v; }
    })),
    field('Header gap', numberInput({
      min: 0, max: 6, step: 0.05,
      get: (state) => state.canvas.rowGapIn,
      set: (draft, v) => { draft.canvas.rowGapIn = v; }
    }))
  ));
  body.appendChild(margins);

  const bg = group('Background');
  append(bg, colorField('Canvas colour', {
    get: (state) => state.canvas.background.color,
    set: (draft, v) => { draft.canvas.background.color = v; }
  }));
  append(bg, checkboxRow('Use a background image', {
    get: (state) => state.canvas.background.useImage,
    set: (draft, v) => { draft.canvas.background.useImage = v; }
  }));
  append(bg, imagePathRow('Background image', backgroundImageProxy,
    { hintText: 'Tiles, textures and watermarks all work. Keep the opacity low so text stays readable.' }));
  append(bg, rangeField('Image opacity', {
    min: 0, max: 100, step: 1,
    get: (state) => Math.round(nOr(state.canvas.background.imageOpacity, 0.25) * 100),
    set: (draft, v) => { draft.canvas.background.imageOpacity = v / 100; },
    format: (v) => `${Math.round(v)}%`
  }));
  append(bg, field('Image fit', selectInput({
    options: [
      { label: 'Cover — fill the sheet', value: 'cover' },
      { label: 'Contain — fit inside', value: 'contain' },
      { label: 'Tile — repeat every inch', value: 'tile' }
    ],
    get: (state) => state.canvas.background.imageFit,
    set: (draft, v) => { draft.canvas.background.imageFit = v; }
  })));
  body.appendChild(bg);

  const view = group('View');
  const zoom = el('div', 'field');
  const zoomInput = el('input');
  zoomInput.type = 'range';
  zoomInput.min = '5';
  zoomInput.max = '200';
  zoomInput.step = '1';
  zoomInput.id = uid('zoom');
  const zoomLabel = el('label', 'field__label', 'Zoom');
  zoomLabel.htmlFor = zoomInput.id;
  const zoomValue = el('span', 'range-row__value');
  register(() => {
    const pct = Math.round(nOr(posterState.ui.zoom, 0.2) * 100);
    if (!busy(zoomInput)) zoomInput.value = String(pct);
    zoomValue.textContent = `${pct}%`;
  });
  zoomInput.addEventListener('input', () => {
    zoomValue.textContent = `${zoomInput.value}%`;
    posterState.setUI({ zoom: Number(zoomInput.value) / 100 });
  });
  append(zoom, zoomLabel, append(el('div', 'range-row'), zoomInput, zoomValue));
  append(view, zoom, button('Fit poster to window', {
    variant: 'ghost',
    onClick: () => posterState.setUI({ zoom: computeFitZoom(s()) })
  }));
  body.appendChild(view);

  return sec;
}

/**
 * The canvas background stores its image as three flat fields rather than an
 * <Image>. Present a conforming view of them so `imagePathRow` can be reused.
 */
function backgroundImageProxy(state) {
  const bg = state.canvas.background;
  return {
    get path() { return bg.imagePath; },
    set path(v) { bg.imagePath = v; },
    get dataUrl() { return bg.imageDataUrl; },
    set dataUrl(v) { bg.imageDataUrl = v; },
    get alt() { return 'Poster background'; },
    set alt(_v) { /* the background has no alt text of its own */ },
    get fit() { return bg.imageFit; },
    set fit(v) { bg.imageFit = v; }
  };
}

function marginInput(side) {
  return numberInput({
    min: 0, max: 12, step: 0.05,
    get: (state) => state.canvas.margins[side],
    set: (draft, v) => { draft.canvas.margins[side] = v; }
  });
}

/** Largest zoom at which the whole sheet fits the stage, with a little breathing room. */
function computeFitZoom(state) {
  const stage = document.getElementById('stage');
  if (!stage) return 0.2;
  const pad = 64;
  const availableW = Math.max(120, stage.clientWidth - pad);
  const availableH = Math.max(120, stage.clientHeight - pad);
  const fit = Math.min(
    availableW / (state.canvas.widthIn * 96),
    availableH / (state.canvas.heightIn * 96)
  );
  return Math.max(0.05, Math.min(2, Number(fit.toFixed(3))));
}

/* ------------------------------------------------------------------ *
 * Section 3 — Header
 * ------------------------------------------------------------------ */

function buildHeaderSection() {
  const sec = section('Header & Title', { id: 'header' });
  const body = sec.body;

  body.appendChild(fieldRow(2,
    field('Band height (in)', numberInput({
      min: 0.5, max: 20, step: 0.25,
      get: (state) => state.header.heightIn,
      set: (draft, v) => { draft.header.heightIn = v; }
    })),
    field('Alignment', selectInput({
      options: [{ label: 'Centred', value: 'center' }, { label: 'Left', value: 'left' }],
      get: (state) => state.header.align,
      set: (draft, v) => { draft.header.align = v; }
    }))
  ));

  body.appendChild(field('Paper title', textareaInput({
    rows: 3,
    placeholder: 'The title of your paper',
    get: (state) => state.header.title,
    set: (draft, v) => { draft.header.title = v; }
  })));

  body.appendChild(field('Authors', textareaInput({
    rows: 2,
    placeholder: 'A. Researcher¹, B. Colleague²',
    get: (state) => state.header.authors,
    set: (draft, v) => { draft.header.authors = v; }
  })));

  body.appendChild(field('Affiliations', textareaInput({
    rows: 3,
    placeholder: '¹Department, University\n²Institute, City',
    get: (state) => state.header.affiliations,
    set: (draft, v) => { draft.header.affiliations = v; }
  }), 'One affiliation per line.'));

  const scales = group('Type scale');
  append(scales,
    rangeField('Title', scaleCfg('titleScale')),
    rangeField('Authors', scaleCfg('authorsScale')),
    rangeField('Affiliations', scaleCfg('affiliationsScale'))
  );
  body.appendChild(scales);

  const left = group('Logo — left');
  append(left,
    field('Box width (in)', numberInput({
      min: 0, max: 12, step: 0.1,
      get: (state) => state.header.logoLeft.widthIn,
      set: (draft, v) => { draft.header.logoLeft.widthIn = v; }
    })),
    imagePathRow('Image', (draft) => draft.header.logoLeft.image)
  );
  body.appendChild(left);

  const right = group('Logo — right');
  append(right,
    field('Box width (in)', numberInput({
      min: 0, max: 12, step: 0.1,
      get: (state) => state.header.logoRight.widthIn,
      set: (draft, v) => { draft.header.logoRight.widthIn = v; }
    })),
    imagePathRow('Image', (draft) => draft.header.logoRight.image)
  );
  body.appendChild(right);

  return sec;
}

function scaleCfg(key) {
  return {
    min: 0.4, max: 2.5, step: 0.05,
    get: (state) => state.header[key],
    set: (draft, v) => { draft.header[key] = v; },
    format: (v) => `${Math.round(v * 100)}%`
  };
}

/* ------------------------------------------------------------------ *
 * Section 6 — Global styles
 * ------------------------------------------------------------------ */

function buildStyleSection() {
  const sec = section('Global Styles', { id: 'style' });
  const body = sec.body;

  body.appendChild(field('Font family', selectInput({
    options: FONT_STACKS.map((f) => ({ label: f.label, value: f.value })),
    get: (state) => state.style.fontFamily,
    set: (draft, v) => { draft.style.fontFamily = v; }
  })));

  body.appendChild(rangeField('Overall text scale', {
    min: 0.5, max: 2, step: 0.02,
    get: (state) => state.style.fontScale,
    set: (draft, v) => { draft.style.fontScale = v; },
    format: (v) => `${Math.round(v * 100)}%`
  }));

  // Section content scale — the same architecture as the header's Type scale
  // group (titleScale/authorsScale/affiliationsScale): one multiplier in the
  // state, emitted by canvas.js as a custom property on the poster root, read
  // once at the top of the subtree by the stylesheet. Everything inside sizes
  // itself in em off that, so h1–h4 and paragraph text move together and the
  // hierarchy survives the resize.
  const sectionScale = rangeField('Section content scale', {
    min: 0.5, max: 2, step: 0.02,
    get: (state) => state.style.sectionScale,
    set: (draft, v) => { draft.style.sectionScale = v; },
    format: (v) => `${Math.round(v * 100)}%`
  });
  sectionScale.appendChild(
    hint('Scales the Markdown inside every block — headings h1–h4 and body paragraphs — in proportion.')
  );
  body.appendChild(sectionScale);

  body.appendChild(field('Body size (in)', numberInput({
    min: 0.1, max: 1.5, step: 0.01,
    get: (state) => state.style.baseFontIn,
    set: (draft, v) => { draft.style.baseFontIn = v; }
  }), 'Cap height of body text on the printed sheet. 0.3–0.4 in reads well from 1.5 m.'));

  const colours = group('Colours');
  append(colours,
    colorField('Headings', styleColour('headingColor')),
    colorField('Body text', styleColour('bodyColor')),
    colorField('Accent', styleColour('accentColor')),
    colorField('Block background', styleColour('blockBg')),
    colorField('Block border', styleColour('blockBorderColor')),
    colorField('Header band', styleColour('headerBg')),
    colorField('Header text', styleColour('headerTextColor')),
    colorField('Title', styleColour('titleColor'))
  );
  body.appendChild(colours);

  const blocks = group('Block appearance');
  append(blocks,
    rangeField('Block opacity', {
      min: 0, max: 100, step: 1,
      get: (state) => Math.round(nOr(state.style.blockOpacity, 1) * 100),
      set: (draft, v) => { draft.style.blockOpacity = v / 100; },
      format: (v) => `${Math.round(v)}%`
    }),
    fieldRow(2,
      field('Corner radius (in)', numberInput({
        min: 0, max: 2, step: 0.02,
        get: (state) => state.style.blockRadiusIn,
        set: (draft, v) => { draft.style.blockRadiusIn = v; }
      })),
      field('Padding (in)', numberInput({
        min: 0, max: 3, step: 0.02,
        get: (state) => state.style.blockPaddingIn,
        set: (draft, v) => { draft.style.blockPaddingIn = v; }
      }))
    ),
    checkboxRow('Show block borders', {
      get: (state) => state.style.showBlockBorders,
      set: (draft, v) => { draft.style.showBlockBorders = v; }
    })
  );
  body.appendChild(blocks);

  const bands = group('Section headers');
  append(bands,
    field('Band height (in)', numberInput({
      min: 0.2, max: 6, step: 0.05,
      get: (state) => state.style.sectionHeaderIn,
      set: (draft, v) => { draft.style.sectionHeaderIn = v; }
    }), 'Applies to every section-header block, so the bands line up across columns.'),
    fieldRow(2,
      colorField('Band colour', styleColour('sectionHeaderBg')),
      colorField('Band text', styleColour('sectionHeaderColor'))
    )
  );
  body.appendChild(bands);

  const themes = group('Theme presets');
  const chips = el('div', 'swatch-row');
  for (const preset of THEME_PRESETS) {
    const chip = el('button', 'chip', preset.label);
    chip.type = 'button';
    chip.title = `Apply the ${preset.label} palette`;
    chip.addEventListener('click', () => {
      posterState.update((draft) => {
        Object.assign(draft.style, preset.patch.style || {});
        if (preset.patch.canvas) Object.assign(draft.canvas, preset.patch.canvas);
      });
      toast(`Applied “${preset.label}”`, 'success');
    });
    chips.appendChild(chip);
  }
  append(themes, chips, button('Restore default styling', {
    variant: 'ghost',
    onClick: () => posterState.update((draft) => { draft.style = defaultStyle(); })
  }));
  body.appendChild(themes);

  return sec;
}

function styleColour(key) {
  return {
    get: (state) => state.style[key],
    set: (draft, v) => { draft.style[key] = v; }
  };
}

/* ------------------------------------------------------------------ *
 * Section 4 — Columns
 * ------------------------------------------------------------------ */

function buildColumnsSection() {
  const sec = section('Columns', { id: 'columns' });
  const body = sec.body;

  body.appendChild(field('Number of columns', selectInput({
    structural: true,
    options: [1, 2, 3, 4, 5, 6].map((n) => ({ label: `${n} column${n > 1 ? 's' : ''}`, value: String(n) })),
    get: (state) => state.columns.length,
    set: (draft, v) => setColumnCount(draft, Number(v))
  }), 'Existing columns and their contents are kept.'));

  const list = el('div', 'panel-group');
  regions.columns.el = list;
  body.appendChild(list);

  const balance = el('p', 'field__hint');
  register(() => {
    const state = s();
    const widths = computeColumnWidths(state);
    const box = contentBoxIn(state);
    const gaps = Math.max(0, state.columns.length - 1) * state.canvas.columnGapIn;
    const used = widths.reduce((a, b) => a + b, 0) + gaps;
    const slack = box.width - used;
    balance.textContent = Math.abs(slack) < 0.02
      ? `Columns exactly fill the ${fmt(box.width)} in printable width.`
      : slack > 0
        ? `${fmt(slack)} in of unused width — give a column an "auto" width to absorb it.`
        : `Over by ${fmt(-slack)} in — widths were scaled down to fit.`;
  });
  body.appendChild(balance);

  return sec;
}

function rebuildColumns() {
  const list = regions.columns.el;
  if (!list) return;
  list.textContent = '';
  list.appendChild(el('h4', 'panel-group__title', 'Per-column width & label'));

  const state = s();
  const widths = computeColumnWidths(state);

  state.columns.forEach((column, index) => {
    const id = column.id;
    const widthField = field('Width (in)', numberInput({
      min: 0.5, max: 200, step: 0.25, allowBlank: true,
      placeholder: 'auto',
      get: (st) => {
        const col = st.columns.find((c) => c.id === id);
        return col ? col.widthIn : null;
      },
      set: (draft, v) => {
        const col = draft.columns.find((c) => c.id === id);
        if (col) col.widthIn = v;
      }
    }));

    const labelField = field('Label', textInput({
      placeholder: `Column ${index + 1}`,
      get: (st) => {
        const col = st.columns.find((c) => c.id === id);
        return col ? col.label : '';
      },
      set: (draft, v) => {
        const col = draft.columns.find((c) => c.id === id);
        if (col) col.label = v;
      }
    }));

    const resolved = el('p', 'field__hint');
    register(() => {
      const st = s();
      const at = st.columns.findIndex((c) => c.id === id);
      if (at < 0) return;
      const w = computeColumnWidths(st)[at];
      resolved.textContent = st.columns[at].widthIn === null
        ? `auto → ${fmt(w)} in`
        : `${fmt(w)} in`;
    });

    const card = el('div', 'field');
    append(card,
      el('div', 'field__label field__label--muted', `${index + 1}. ${column.label} (${fmt(widths[index])} in)`),
      fieldRow(2, widthField, labelField),
      resolved
    );
    list.appendChild(card);
  });

  list.appendChild(hint('Leave a width blank for "auto" — that column absorbs whatever space is left.'));
}

/* ------------------------------------------------------------------ *
 * Section 5 — Document tree
 * ------------------------------------------------------------------ */

function buildTreeSection() {
  const sec = section('Document Tree', { open: true, id: 'tree' });
  const tree = el('div', 'tree');
  regions.tree.el = tree;
  sec.body.appendChild(tree);
  sec.body.appendChild(hint('Click any entry to scroll the canvas to it and select it.'));
  return sec;
}

function treeItem({ id, label, meta, depth, type }) {
  const item = el('button', 'tree__item');
  item.type = 'button';
  item.dataset.id = id;
  item.dataset.type = type;
  item.style.setProperty('--depth', String(depth));
  if (posterState.ui.selectedId === id) item.classList.add('is-selected');

  append(item,
    el('span', 'tree__icon'),
    el('span', 'tree__label', label),
    meta ? el('span', 'tree__meta', meta) : null
  );

  item.addEventListener('click', () => {
    posterState.setUI({ selectedId: id });
    scrollToBlock(id);
  });
  return item;
}

function rebuildTree() {
  const tree = regions.tree.el;
  if (!tree) return;
  tree.textContent = '';

  const state = s();

  tree.appendChild(treeItem({
    id: 'header.title', type: 'header', depth: 0,
    label: state.header.title || 'Untitled poster', meta: 'title'
  }));
  tree.appendChild(treeItem({
    id: 'header.authors', type: 'header', depth: 1,
    label: state.header.authors || 'No authors yet', meta: 'authors'
  }));
  tree.appendChild(treeItem({
    id: 'header.affiliations', type: 'header', depth: 1,
    label: (state.header.affiliations || 'No affiliations').split('\n')[0], meta: 'affil.'
  }));
  tree.appendChild(treeItem({
    id: 'header.logoLeft', type: 'image', depth: 1,
    label: state.header.logoLeft.image.path || 'Logo left (empty)', meta: 'logo L'
  }));
  tree.appendChild(treeItem({
    id: 'header.logoRight', type: 'image', depth: 1,
    label: state.header.logoRight.image.path || 'Logo right (empty)', meta: 'logo R'
  }));

  const widths = computeColumnWidths(state);
  state.columns.forEach((column, index) => {
    tree.appendChild(treeItem({
      id: column.root.id, type: 'column', depth: 0,
      label: column.label || `Column ${index + 1}`,
      meta: `${fmt(widths[index])} in`
    }));
    if (column.root.kind === 'split') {
      for (const child of column.root.children) appendTreeNode(tree, child, 1);
    }
  });
}

function appendTreeNode(tree, block, depth) {
  if (block.kind === 'split') {
    tree.appendChild(treeItem({
      id: block.id, type: 'split', depth,
      label: blockDisplayLabel(block),
      meta: `${block.children.length}`
    }));
    for (const child of block.children) appendTreeNode(tree, child, depth + 1);
    return;
  }

  tree.appendChild(treeItem({
    id: block.id, type: block.type, depth,
    label: blockDisplayLabel(block),
    meta: block.fixedIn ? `${fmt(block.fixedIn)} in` : `×${fmt(block.ratio, 2)}`
  }));
}

/** What the tree shows for a block: its heading, or a preview of its content. */
function blockDisplayLabel(block) {
  if (block.kind === 'split') {
    return block.orientation === 'rows' ? 'Stacked rows' : 'Side-by-side columns';
  }
  if (block.type === 'section') {
    // A section header has no separate heading bar — its Markdown IS the banner.
    return firstLine(block.markdown) || 'Section header';
  }
  if (block.label) return block.label;
  if (block.type === 'image') {
    return block.image && block.image.path ? block.image.path.split('/').pop() : 'Image block';
  }
  return firstLine(block.markdown) || 'Text block';
}

/** First meaningful line of Markdown, stripped of leading hashes. */
function firstLine(markdown) {
  if (!markdown) return '';
  for (const line of String(markdown).split('\n')) {
    const trimmed = line.replace(/^#{1,6}\s*/, '').trim();
    if (trimmed) return trimmed.slice(0, 60);
  }
  return '';
}

/* ------------------------------------------------------------------ *
 * Section 7 — Selected block inspector
 * ------------------------------------------------------------------ */

function buildInspectorSection() {
  const sec = section('Selected Block', { open: true, id: 'inspector' });
  const host = el('div');
  regions.inspector.el = host;
  sec.body.appendChild(host);
  return sec;
}

function rebuildInspector() {
  const host = regions.inspector.el;
  if (!host) return;
  host.textContent = '';

  const id = posterState.ui.selectedId;
  if (!id) {
    host.appendChild(el('p', 'empty-state',
      'Nothing selected. Click a block on the canvas, or an entry in the document tree.'));
    return;
  }

  if (String(id).startsWith('header.')) {
    const note = el('p', 'panel-note');
    note.textContent = `Editing “${id.split('.')[1]}” — its controls live in the Header & Title section above.`;
    append(host, note, button('Open Header & Title', {
      variant: 'ghost',
      onClick: () => {
        const target = document.querySelector('[data-section="header"]');
        if (target) {
          target.open = true;
          target.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
      }
    }));
    return;
  }

  const hit = findBlock(s(), id);
  if (!hit) {
    host.appendChild(el('p', 'empty-state', 'That block no longer exists.'));
    return;
  }

  const block = hit.block;
  append(host, buildBlockActions(id, hit));

  if (block.kind === 'split') {
    append(host, buildSplitInspector(id));
    return;
  }
  append(host, buildLeafInspector(id, block));
}

/** Size + structure controls shared by leaves and splits. */
function buildBlockActions(id, hit) {
  const wrap = el('div');

  const header = el('p', 'panel-note');
  const LEAF_NOUN = { image: 'Image', section: 'Section header', markdown: 'Text' };
  header.textContent = hit.block.kind === 'split'
    ? `Split (${hit.block.orientation === 'rows' ? 'stacked rows' : 'side-by-side'}) with ${hit.block.children.length} children`
    : `${LEAF_NOUN[hit.block.type] || 'Text'} block in ${hit.column ? hit.column.label : 'a column'}`;
  wrap.appendChild(header);

  wrap.appendChild(fieldRow(2,
    field('Size ratio', numberInput({
      min: 0.05, max: 20, step: 0.05,
      get: (state) => { const h = findBlock(state, id); return h ? h.block.ratio : 1; },
      set: (draft, v) => { const h = findBlock(draft, id); if (h) h.block.ratio = v; }
    })),
    field('Exact size (in)', numberInput({
      min: 0.2, max: 200, step: 0.1, allowBlank: true, placeholder: 'auto',
      get: (state) => { const h = findBlock(state, id); return h ? h.block.fixedIn : null; },
      set: (draft, v) => { const h = findBlock(draft, id); if (h) h.block.fixedIn = v; }
    }))
  ));
  wrap.appendChild(hint('Ratio shares the leftover space with its siblings. An exact size wins over the ratio.'));

  if (hit.block.type === 'section') {
    wrap.appendChild(hint('Stacked vertically, a section header ignores its ratio and takes the global '
      + 'band height instead — that is what keeps the bands aligned. An exact size opts this one out.'));
  }

  if (hit.parent) {
    wrap.appendChild(field('Gap between siblings (in)', numberInput({
      min: 0, max: 4, step: 0.02,
      get: (state) => { const h = findBlock(state, id); return h && h.parent ? h.parent.gapIn : 0; },
      set: (draft, v) => { const h = findBlock(draft, id); if (h && h.parent) h.parent.gapIn = v; }
    })));
  }

  const structure = group('Structure');
  append(structure,
    append(el('div', 'btn-group btn-group--grow'),
      button('⬍ Split into rows', {
        variant: 'ghost',
        onClick: () => {
          const newId = posterState.update((draft) => splitBlock(draft, id, 'rows'), { structural: true });
          if (newId) posterState.setUI({ selectedId: newId });
        }
      }),
      button('⬌ Split into columns', {
        variant: 'ghost',
        onClick: () => {
          const newId = posterState.update((draft) => splitBlock(draft, id, 'cols'), { structural: true });
          if (newId) posterState.setUI({ selectedId: newId });
        }
      })
    ),
    append(el('div', 'btn-group btn-group--grow'),
      button('↑ Move earlier', {
        variant: 'ghost',
        onClick: () => posterState.update((draft) => moveBlock(draft, id, -1), { structural: true })
      }),
      button('↓ Move later', {
        variant: 'ghost',
        onClick: () => posterState.update((draft) => moveBlock(draft, id, 1), { structural: true })
      })
    )
  );

  if (hit.parent) {
    structure.appendChild(button('Delete this block', {
      variant: 'danger',
      onClick: () => {
        posterState.update((draft) => removeBlock(draft, id), { structural: true });
        posterState.setUI({ selectedId: null });
      }
    }));
  } else {
    structure.appendChild(hint('This is a column’s outermost block. Split it to add more, or change the column count above.'));
  }

  wrap.appendChild(structure);
  return wrap;
}

function buildSplitInspector(id) {
  const wrap = group('Split');
  append(wrap,
    field('Direction', selectInput({
      structural: true,
      options: [
        { label: 'Rows — children stack top to bottom', value: 'rows' },
        { label: 'Columns — children sit side by side', value: 'cols' }
      ],
      get: (state) => { const h = findBlock(state, id); return h ? h.block.orientation : 'rows'; },
      set: (draft, v) => { const h = findBlock(draft, id); if (h) h.block.orientation = v; }
    })),
    field('Gap between children (in)', numberInput({
      min: 0, max: 4, step: 0.02,
      get: (state) => { const h = findBlock(state, id); return h ? h.block.gapIn : 0.25; },
      set: (draft, v) => { const h = findBlock(draft, id); if (h) h.block.gapIn = v; }
    }))
  );
  return wrap;
}

function buildLeafInspector(id, block) {
  const wrap = el('div');

  // A section header is its own heading, so the heading-bar field would be a
  // second, conflicting title. Everything else keeps it.
  if (block.type !== 'section') {
    wrap.appendChild(field('Block heading', textInput({
      placeholder: 'Leave empty to hide the heading bar',
      get: (state) => { const h = findBlock(state, id); return h ? h.block.label : ''; },
      set: (draft, v) => { const h = findBlock(draft, id); if (h) h.block.label = v; }
    })));
  }

  wrap.appendChild(field('Content type', selectInput({
    structural: true,
    options: [
      { label: 'Markdown text', value: 'markdown' },
      { label: 'Section header', value: 'section' },
      { label: 'Image', value: 'image' }
    ],
    get: (state) => { const h = findBlock(state, id); return h ? h.block.type : 'markdown'; },
    set: (draft, v) => setBlockType(draft, id, v)
  })));

  if (block.type === 'section') {
    const band = group('Section header');
    append(band,
      field('Banner text', textInput({
        placeholder: 'Results',
        get: (state) => { const h = findBlock(state, id); return h ? h.block.markdown : ''; },
        set: (draft, v) => { const h = findBlock(draft, id); if (h) h.block.markdown = v; }
      })),
      hint('Every section header on the poster is the same height, set once under '
        + 'Global Styles → Section headers, so the bands line up across columns. '
        + 'Long text shrinks to fit rather than making its band taller.'),
      button('Open Global Styles', {
        variant: 'ghost',
        onClick: () => {
          const target = document.querySelector('[data-section="style"]');
          if (target) {
            target.open = true;
            target.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          }
        }
      })
    );
    wrap.appendChild(band);
    wrap.appendChild(buildOverrides(id));
    return wrap;
  }

  if (block.type === 'image') {
    const img = group('Image');
    append(img,
      imagePathRow('Source', (draft) => {
        const h = findBlock(draft, id);
        return h ? h.block.image : null;
      }),
      fieldRow(2,
        field('Fit', selectInput({
          options: [
            { label: 'Contain', value: 'contain' },
            { label: 'Cover', value: 'cover' },
            { label: 'Fill', value: 'fill' }
          ],
          get: (state) => { const h = findBlock(state, id); return h ? h.block.image.fit : 'contain'; },
          set: (draft, v) => { const h = findBlock(draft, id); if (h) h.block.image.fit = v; }
        })),
        field('Alt text', textInput({
          placeholder: 'Describe the figure',
          get: (state) => { const h = findBlock(state, id); return h ? h.block.image.alt : ''; },
          set: (draft, v) => { const h = findBlock(draft, id); if (h) h.block.image.alt = v; }
        }))
      ),
      field('Caption (Markdown)', textareaInput({
        rows: 3, mono: true, spellcheck: true,
        placeholder: '**Figure 1.** Accuracy against $n$ training samples.',
        get: (state) => {
          const h = findBlock(state, id);
          return h && h.block.image ? (h.block.image.caption || '') : '';
        },
        set: (draft, v) => {
          const h = findBlock(draft, id);
          if (h && h.block.image) h.block.image.caption = v;
        }
      }), 'Sits under the picture, inside the same block. Supports `**bold**`, links and `$…$` maths.')
    );
    wrap.appendChild(img);
  } else {
    const md = group('Markdown');
    const area = textareaInput({
      rows: 10, mono: true, tall: true, spellcheck: true,
      placeholder: MARKDOWN_PLACEHOLDER.slice(0, 80),
      get: (state) => { const h = findBlock(state, id); return h ? h.block.markdown : ''; },
      set: (draft, v) => { const h = findBlock(draft, id); if (h) h.block.markdown = v; }
    });

    const snippets = el('div', 'swatch-row');
    for (const [label, text] of [
      ['Heading', '\n## Heading\n'],
      ['Bullets', '\n- First point\n- Second point\n'],
      ['Bold', '**important**'],
      ['Table', '\n| Method | Accuracy |\n| --- | --- |\n| Ours | **0.94** |\n| Baseline | 0.87 |\n'],
      ['Inline math', ' $E=mc^2$ '],
      ['Display math', '\n$$\\int_0^1 x^2\\,dx = \\tfrac{1}{3}$$\n'],
      ['Figure', '\n![Caption](./assets/placeholders/sample-chart.svg)\n']
    ]) {
      const chip = el('button', 'chip', label);
      chip.type = 'button';
      chip.addEventListener('click', () => insertSnippet(area, text, id));
      snippets.appendChild(chip);
    }

    append(md,
      field('Body', area, 'Markdown with LaTeX: `$…$` inline, `$$…$$` on its own line.'),
      el('p', 'field__label field__label--muted', 'Insert snippet'),
      snippets,
      button('Reset to the starter template', {
        variant: 'ghost',
        onClick: () => posterState.update((draft) => {
          const h = findBlock(draft, id);
          if (h) h.block.markdown = MARKDOWN_PLACEHOLDER;
        })
      })
    );
    wrap.appendChild(md);
  }

  wrap.appendChild(buildOverrides(id));
  return wrap;
}

/** Insert text at the caret and commit, keeping focus in the textarea. */
function insertSnippet(area, text, id) {
  const start = area.selectionStart ?? area.value.length;
  const end = area.selectionEnd ?? area.value.length;
  const next = area.value.slice(0, start) + text + area.value.slice(end);
  area.value = next;
  const caret = start + text.length;
  area.focus();
  area.setSelectionRange(caret, caret);
  posterState.update((draft) => {
    const h = findBlock(draft, id);
    if (h) h.block.markdown = next;
  }, { source: 'inline' });
}

/** Per-block style overrides; every control has a ↺ back to the global value. */
function buildOverrides(id) {
  const wrap = group('This block only');
  wrap.appendChild(hint('Blank or ↺ means “inherit the global style”.'));

  const readStyle = (state) => {
    const h = findBlock(state, id);
    return h && h.block.style ? h.block.style : {};
  };
  const writeStyle = (draft, key, value) => {
    const h = findBlock(draft, id);
    if (!h) return;
    if (!h.block.style) h.block.style = {};
    h.block.style[key] = value;
  };
  const reset = (key) => posterState.update((draft) => writeStyle(draft, key, null));

  append(wrap,
    colorField('Background', {
      get: (state) => readStyle(state).bg ?? null,
      set: (draft, v) => writeStyle(draft, 'bg', v),
      inherited: () => s().style.blockBg,
      onReset: () => reset('bg'),
      placeholder: 'inherit'
    }),
    colorField('Text colour', {
      get: (state) => readStyle(state).textColor ?? null,
      set: (draft, v) => writeStyle(draft, 'textColor', v),
      inherited: () => s().style.bodyColor,
      onReset: () => reset('textColor'),
      placeholder: 'inherit'
    }),
    colorField('Heading colour', {
      get: (state) => readStyle(state).headingColor ?? null,
      set: (draft, v) => writeStyle(draft, 'headingColor', v),
      inherited: () => s().style.headingColor,
      onReset: () => reset('headingColor'),
      placeholder: 'inherit'
    }),
    colorField('Border colour', {
      get: (state) => readStyle(state).borderColor ?? null,
      set: (draft, v) => writeStyle(draft, 'borderColor', v),
      inherited: () => s().style.blockBorderColor,
      onReset: () => reset('borderColor'),
      placeholder: 'inherit'
    })
  );

  // The last two mirror the canvas hover menu's size controls, so a block sized
  // on the poster reads back correctly here and vice versa. Blank means inherit:
  // an explicit pt size overrides the global body size, and the scale then
  // multiplies whichever of the two is in force.
  append(wrap, fieldRow(3,
    field('Opacity (%)', overrideNumber(id, 'opacity', {
      min: 0, max: 100, step: 1,
      toState: (v) => v / 100,
      fromState: (v) => Math.round(v * 100)
    })),
    field('Font size (pt)', overrideNumber(id, 'fontPt', { min: 4, max: 600, step: 1 })),
    field('Text scale (×)', overrideNumber(id, 'fontScale', { min: 0.4, max: 3, step: 0.05 }))
  ));

  append(wrap, fieldRow(2,
    field('Padding (in)', overrideNumber(id, 'paddingIn', { min: 0, max: 3, step: 0.02 })),
    field('Radius (in)', overrideNumber(id, 'radiusIn', { min: 0, max: 2, step: 0.02 }))
  ));

  append(wrap, fieldRow(2,
    field('Border', selectInput({
      options: [
        { label: 'Inherit', value: '' },
        { label: 'Show', value: 'true' },
        { label: 'Hide', value: 'false' }
      ],
      get: (state) => {
        const v = readStyle(state).showBorder;
        return v === null || v === undefined ? '' : String(v);
      },
      set: (draft, v) => writeStyle(draft, 'showBorder', v === '' ? null : v === 'true')
    })),
    field('Text alignment', selectInput({
      options: [
        { label: 'Left', value: 'left' },
        { label: 'Centre', value: 'center' },
        { label: 'Right', value: 'right' },
        { label: 'Justify', value: 'justify' }
      ],
      get: (state) => readStyle(state).align || 'left',
      set: (draft, v) => writeStyle(draft, 'align', v)
    }))
  ));

  wrap.appendChild(button('Clear every override on this block', {
    variant: 'ghost',
    onClick: () => posterState.update((draft) => {
      const h = findBlock(draft, id);
      if (!h) return;
      h.block.style = {
        bg: null, opacity: null, fontScale: null, fontPt: null, textColor: null,
        headingColor: null, borderColor: null, showBorder: null,
        paddingIn: null, radiusIn: null, align: 'left'
      };
    })
  }));

  return wrap;
}

/** A nullable numeric override plus its ↺ button. */
function overrideNumber(id, key, { min, max, step, toState, fromState }) {
  const input = numberInput({
    min, max, step, allowBlank: true, placeholder: 'inherit',
    get: (state) => {
      const h = findBlock(state, id);
      const raw = h && h.block.style ? h.block.style[key] : null;
      if (raw === null || raw === undefined) return null;
      return fromState ? fromState(raw) : raw;
    },
    set: (draft, v) => {
      const h = findBlock(draft, id);
      if (!h) return;
      if (!h.block.style) h.block.style = {};
      h.block.style[key] = v === null ? null : (toState ? toState(v) : v);
    }
  });

  return controlRow(input, iconButton('↺', {
    title: 'Reset to the global value',
    onClick: () => posterState.update((draft) => {
      const h = findBlock(draft, id);
      if (h && h.block.style) h.block.style[key] = null;
    })
  }));
}

/* ------------------------------------------------------------------ *
 * Section 8 — Markdown & LaTeX guide
 * ------------------------------------------------------------------ */

const CHEATSHEET = [
  ['## Heading', 'Section heading (### for a smaller one)'],
  ['**bold**  *italic*', 'Emphasis'],
  ['- item', 'Bullet list'],
  ['1. item', 'Numbered list'],
  ['`code`', 'Inline code'],
  ['> quote', 'Block quote'],
  ['---', 'Horizontal rule'],
  ['[label](https://…)', 'Link'],
  ['![alt](./assets/fig.png)', 'Image — same path rules as image blocks'],
  ['| A | B |\\n| --- | --- |\\n| 1 | 2 |', 'Table'],
  ['$E=mc^2$', 'Inline maths'],
  ['$$\\int_0^1 x^2\\,dx$$', 'Display maths on its own line'],
  ['\\$5', 'A literal dollar sign']
];

function buildGuideSection() {
  const sec = section('Markdown & LaTeX Guide', { id: 'guide' });
  const table = el('table', 'help-table');
  const caption = el('caption', null, 'Click any snippet to copy it');
  table.appendChild(caption);

  const tbody = el('tbody');
  for (const [syntax, meaning] of CHEATSHEET) {
    const tr = el('tr');
    const td1 = el('td');
    const code = el('code', 'mono', syntax);
    code.tabIndex = 0;
    code.title = 'Click to copy';
    code.style.cursor = 'copy';
    const copy = () => {
      const text = syntax.replace(/\\n/g, '\n');
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text)
          .then(() => toast('Copied', 'success', 1400))
          .catch(() => toast('Could not access the clipboard', 'warn'));
      } else {
        toast('Clipboard is unavailable in this browser', 'warn');
      }
    };
    code.addEventListener('click', copy);
    code.addEventListener('keydown', (e) => { if (e.key === 'Enter') copy(); });
    td1.appendChild(code);
    append(tr, td1, el('td', null, meaning));
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);

  append(sec.body, table, hint(
    'Maths renders with KaTeX when the CDN is reachable; offline it falls back to showing the LaTeX source so nothing is lost.'
  ));
  return sec;
}

/* ------------------------------------------------------------------ *
 * Mount
 * ------------------------------------------------------------------ */

/** Run every registered syncer, tolerating a failure in any one of them. */
function sync() {
  for (const fn of syncers) {
    try {
      fn();
    } catch (err) {
      console.error('A panel control failed to sync', err);
    }
  }
}

/**
 * Build the sidebar and keep it in step with the store.
 * @param {HTMLElement} rootEl the `#left-panel` aside
 * @returns {{sync: () => void, rebuild: () => void}}
 */
export function mountLeftPanel(rootEl) {
  if (!rootEl) throw new Error('mountLeftPanel requires a root element');

  syncers = [];
  currentOwner = null;
  rootEl.textContent = '';

  append(rootEl,
    buildProjectSection(),
    buildCanvasSection(),
    buildHeaderSection(),
    buildColumnsSection(),
    buildTreeSection(),
    buildStyleSection(),
    buildInspectorSection(),
    buildGuideSection()
  );

  /**
   * Rebuild only the regions whose structure actually changed, then re-sync.
   * `force` is used after a whole-state replacement.
   */
  const rebuild = (force) => {
    const state = s();

    const colSig = columnsSignature(state);
    if (force || colSig !== regions.columns.sig) {
      regions.columns.sig = colSig;
      dropSyncersWithin(regions.columns.el);
      rebuildColumns();
    }

    const treeSig = treeSignature(state);
    if (force || treeSig !== regions.tree.sig) {
      regions.tree.sig = treeSig;
      dropSyncersWithin(regions.tree.el);
      rebuildTree();
    }

    const inspSig = inspectorSignature(state);
    if (force || inspSig !== regions.inspector.sig) {
      regions.inspector.sig = inspSig;
      dropSyncersWithin(regions.inspector.el);
      rebuildInspector();
    }

    currentOwner = null;
  };

  posterState.subscribe((_state, meta) => {
    rebuild(!!(meta && meta.replaced));
    sync();
    revealSelection(rootEl);
  });

  rebuild(true);
  sync();

  return { sync, rebuild: () => rebuild(true) };
}

/**
 * Bring the sidebar to the block the user just clicked on the canvas.
 *
 * Runs after `rebuild()`, so the inspector already holds the right controls;
 * this only opens the two sections that matter, scrolls them into view and
 * flashes the inspector so the eye can find where the panel jumped to.
 *
 * The `focusSource` flag is consumed here — cleared by direct assignment rather
 * than `setUI`, because `setUI` notifies and would re-enter this function.
 *
 * @param {HTMLElement} rootEl the `#left-panel` aside
 */
function revealSelection(rootEl) {
  if (posterState.ui.focusSource !== 'canvas') return;
  posterState.ui.focusSource = null;

  const id = posterState.ui.selectedId;
  if (!id) return;

  // A header field is edited in Header & Title; everything else in the inspector.
  const wanted = String(id).startsWith('header.') ? 'header' : 'inspector';
  const target = rootEl.querySelector(`[data-section="${wanted}"]`);
  if (!target) return;
  target.open = true;

  const row = rootEl.querySelector(`.tree__item[data-id="${cssEscape(id)}"]`);
  if (row) {
    const treeSection = rootEl.querySelector('[data-section="tree"]');
    if (treeSection) treeSection.open = true;
    row.scrollIntoView({ block: 'nearest' });
  }

  target.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  target.classList.remove('is-flashing');
  // Reading offsetWidth restarts the animation when the same section is
  // revealed twice in a row; without it the class is re-added in the same
  // frame it was removed and nothing visibly happens.
  void target.offsetWidth;
  target.classList.add('is-flashing');
}

/** `CSS.escape` where available, with a conservative fallback for our own ids. */
function cssEscape(value) {
  const str = String(value);
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(str);
  return str.replace(/[^a-zA-Z0-9_-]/g, (ch) => `\\${ch}`);
}

/**
 * Drop the syncers belonging to a region we are about to replace, and make that
 * region the owner of everything registered next.
 */
function dropSyncersWithin(container) {
  if (!container) return;
  syncers = syncers.filter((fn) => fn.owner !== container);
  currentOwner = container;
}
