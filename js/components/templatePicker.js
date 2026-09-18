/**
 * templatePicker.js — the "Templates" menu in the top bar.
 *
 * Renders whatever `templates.config.js` exports, so this file never needs
 * editing to add a template. Its only real responsibility beyond drawing the
 * menu is making sure a click here cannot silently destroy work: applying a
 * template replaces the whole document, so anything that is not still the
 * untouched starter poster earns a confirmation first.
 *
 * The replacement goes through `posterState.set()`, which records history — so
 * even a confirmed mistake is one Ctrl+Z away.
 */

import { posterState } from '../posterState.js';
import { defaultPoster } from '../data.js';
import { toast } from '../storage.js';
import { POSTER_TEMPLATES, findTemplate, buildTemplateState } from '../templates.config.js';

/* ------------------------------------------------------------------ *
 * "Is there anything to lose?"
 * ------------------------------------------------------------------ */

/**
 * A stable string for the parts of a document the user can actually author.
 *
 * `meta` is excluded because timestamps and the document name differ on every
 * instantiation, and block ids are excluded because the factories mint fresh
 * ones each time — two structurally identical posters would otherwise never
 * compare equal.
 *
 * @param {object} state
 * @returns {string}
 */
function contentFingerprint(state) {
  if (!state) return '';
  const branches = {
    canvas: state.canvas,
    style: state.style,
    header: state.header,
    columns: state.columns
  };
  try {
    return JSON.stringify(branches, (key, value) => (key === 'id' ? undefined : value));
  } catch (err) {
    // A circular or otherwise unserialisable document should never suppress the
    // warning — fall back to a value nothing can match, so the confirm shows.
    console.warn('templatePicker could not fingerprint the document', err);
    return `unfingerprintable:${Math.random()}`;
  }
}

/**
 * Fingerprints of the documents that represent "no work yet": the pristine
 * starter poster and every template exactly as it ships. Computed once and
 * cached, because building six posters on each menu click is wasteful and the
 * definitions cannot change at runtime.
 * @type {Set<string>|null}
 */
let pristineFingerprints = null;

function pristineSet() {
  if (pristineFingerprints) return pristineFingerprints;
  pristineFingerprints = new Set([contentFingerprint(defaultPoster())]);
  for (const template of POSTER_TEMPLATES) {
    const built = buildTemplateState(template);
    if (built) pristineFingerprints.add(contentFingerprint(built));
  }
  return pristineFingerprints;
}

/**
 * Ask before discarding, unless the current document is still one of the
 * as-shipped starting points.
 *
 * `posterState.isDirty()` deliberately is NOT the test: autosave clears the
 * dirty flag within a second of every edit, and a reload starts clean, so a
 * fully written poster would report "no unsaved changes" and be replaced
 * without a word.
 *
 * @param {object} template the template about to be applied
 * @returns {boolean} true when the caller may proceed
 */
function confirmDiscard(template) {
  if (pristineSet().has(contentFingerprint(posterState.get()))) return true;
  return window.confirm(
    `Replace the current poster with the "${template.label}" template?\n\n` +
    'Everything on the canvas — text, images, layout and styling — is discarded. ' +
    'Export a JSON copy first if you want to keep it.\n\n' +
    'This can be undone with Ctrl/Cmd+Z.'
  );
}

/* ------------------------------------------------------------------ *
 * Menu construction
 * ------------------------------------------------------------------ */

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

/** One card: identity colours, name, what it is for, and the sheet it opens at. */
function buildCard(template) {
  const card = el('button', 'tpl-card');
  card.type = 'button';
  card.setAttribute('role', 'menuitem');
  card.dataset.templateId = template.id;
  card.title = template.blurb;

  const swatch = el('span', 'tpl-card__swatch');
  swatch.setAttribute('aria-hidden', 'true');
  for (const colour of template.swatch || []) {
    const dot = el('span', 'tpl-card__dot');
    dot.style.background = colour;
    swatch.appendChild(dot);
  }

  const body = el('span', 'tpl-card__body');
  body.appendChild(el('span', 'tpl-card__label', template.label));
  body.appendChild(el('span', 'tpl-card__meta', `${template.useCase} · ${template.size}`));
  body.appendChild(el('span', 'tpl-card__blurb', template.blurb));

  // Marks the template this document came from. Purely a wayfinding cue.
  const tick = el('span', 'tpl-card__tick', '✓');
  tick.setAttribute('aria-hidden', 'true');

  card.append(swatch, body, tick);
  return card;
}

/* ------------------------------------------------------------------ *
 * Mount
 * ------------------------------------------------------------------ */

/**
 * Turn an existing top-bar button into the template chooser.
 *
 * @param {HTMLElement} buttonEl the trigger, already in the document
 * @param {{onApply?: (template:object) => void}} [opts]
 *        `onApply` runs after the store has been replaced — the app uses it to
 *        re-fit the zoom, since a template usually changes the sheet size.
 * @returns {{open: () => void, close: () => void}|null}
 */
export function mountTemplatePicker(buttonEl, opts = {}) {
  if (!buttonEl) return null;

  const menu = el('div', 'tpl-menu');
  menu.id = 'template-menu';
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', 'Quick-start templates');
  menu.hidden = true;

  menu.appendChild(el(
    'p',
    'tpl-menu__intro',
    'Start from a ready-made poster. Each one loads its own sheet size, colours and sample content.'
  ));

  const list = el('div', 'tpl-menu__list');
  for (const template of POSTER_TEMPLATES) list.appendChild(buildCard(template));
  menu.appendChild(list);

  // The menu is a child of the button's own wrapper so it can be positioned
  // relative to it without measuring anything on scroll or resize.
  const shell = el('div', 'tpl-picker');
  buttonEl.parentNode.insertBefore(shell, buttonEl);
  shell.appendChild(buttonEl);
  shell.appendChild(menu);

  buttonEl.setAttribute('aria-haspopup', 'menu');
  buttonEl.setAttribute('aria-expanded', 'false');
  buttonEl.setAttribute('aria-controls', menu.id);

  const cards = () => Array.from(list.querySelectorAll('.tpl-card'));

  function markCurrent() {
    const state = posterState.get();
    const active = state && state.meta ? state.meta.templateId : null;
    for (const card of cards()) {
      const isActive = !!active && card.dataset.templateId === active;
      card.classList.toggle('is-current', isActive);
      // aria-checked would imply a radio group; "current" is the honest word
      // for "this is where the document started".
      if (isActive) card.setAttribute('aria-current', 'true');
      else card.removeAttribute('aria-current');
    }
  }

  function open() {
    if (!menu.hidden) return;
    markCurrent();
    menu.hidden = false;
    buttonEl.setAttribute('aria-expanded', 'true');
    const first = cards().find((c) => c.classList.contains('is-current')) || cards()[0];
    if (first) first.focus();
  }

  function close({ restoreFocus = true } = {}) {
    if (menu.hidden) return;
    menu.hidden = true;
    buttonEl.setAttribute('aria-expanded', 'false');
    if (restoreFocus) buttonEl.focus();
  }

  function apply(id) {
    const template = findTemplate(id);
    if (!template) return;

    const next = buildTemplateState(template);
    if (!next) {
      toast('That template could not be built', 'error');
      return;
    }
    if (!confirmDiscard(template)) {
      close();
      return;
    }

    close();
    posterState.set(next);
    // A replaced document has no meaningful selection, and a stale id would
    // leave the inspector pointing at a block that no longer exists.
    posterState.setUI({ selectedId: null });
    if (typeof opts.onApply === 'function') opts.onApply(template);
    toast(`Loaded the ${template.label} template`, 'success');
  }

  buttonEl.addEventListener('click', (event) => {
    event.preventDefault();
    if (menu.hidden) open();
    else close();
  });

  list.addEventListener('click', (event) => {
    const card = event.target.closest('.tpl-card');
    if (card) apply(card.dataset.templateId);
  });

  // Roving arrow keys inside the menu, matching native menu behaviour.
  menu.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      close();
      return;
    }
    const items = cards();
    const index = items.indexOf(document.activeElement);
    if (index === -1) return;

    let target = -1;
    if (event.key === 'ArrowDown') target = (index + 1) % items.length;
    else if (event.key === 'ArrowUp') target = (index - 1 + items.length) % items.length;
    else if (event.key === 'Home') target = 0;
    else if (event.key === 'End') target = items.length - 1;
    if (target === -1) return;

    event.preventDefault();
    items[target].focus();
  });

  // Any click outside the shell dismisses. Capture phase so it still fires when
  // the click lands on something that stops propagation.
  document.addEventListener('pointerdown', (event) => {
    if (menu.hidden) return;
    if (!shell.contains(event.target)) close({ restoreFocus: false });
  }, true);

  // Tabbing out of the menu should close it as well, or the popover lingers
  // over the canvas with focus somewhere else entirely.
  menu.addEventListener('focusout', () => {
    window.setTimeout(() => {
      if (!menu.hidden && !shell.contains(document.activeElement)) close({ restoreFocus: false });
    }, 0);
  });

  posterState.subscribe((state, meta) => {
    if (meta && meta.uiOnly) return;
    if (!menu.hidden) markCurrent();
  });

  return { open, close };
}
