/**
 * markdownSerialize.js — the inverse of `renderRichText()`.
 *
 * Live canvas editing works by making the RENDERED Markdown editable rather than
 * showing raw source: the user sees the poster exactly as it will print while
 * they type. That only works if the DOM can be turned back into Markdown on every
 * keystroke, which is what this module does.
 *
 * Scope is deliberately the same subset the renderer produces (and that the
 * offline `miniMarkdown` fallback produces): headings, paragraphs, emphasis,
 * links, images, lists, blockquotes, rules, fenced code and GFM tables. Anything
 * outside that — most importantly KaTeX output — is round-tripped verbatim
 * through a `data-md` attribute that the renderer stamps on at build time, so a
 * `$\alpha$` span survives an edit untouched instead of being re-serialised from
 * the several hundred nodes KaTeX expands it into.
 *
 * Contract: `serializeProse(renderRichText(md)) === md` is NOT guaranteed
 * character for character — whitespace and equivalent syntaxes (`*x*` vs `_x_`)
 * normalise. It IS guaranteed to be semantically stable, i.e. re-rendering the
 * result produces the same DOM, which is the property inline editing needs.
 */

/** Elements that are round-tripped by their `data-md` payload, not their DOM. */
const VERBATIM_ATTR = 'data-md';

/** Inline wrappers the editor is allowed to emit as raw HTML in the source. */
const RAW_INLINE_CLASSES = ['ps-pt'];

/* ------------------------------------------------------------------ *
 * Entry point
 * ------------------------------------------------------------------ */

/**
 * Serialise a rendered `.prose` subtree back to Markdown.
 * @param {HTMLElement} root the element whose CHILDREN are the rendered blocks
 * @returns {string} Markdown source
 */
export function serializeProse(root) {
  if (!root) return '';
  const out = blocks(Array.from(root.childNodes), '');
  // Collapse the runs of blank lines that nested structures naturally produce,
  // and drop the trailing one so an unchanged block does not grow on every edit.
  return out.replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '');
}

/**
 * Serialise a subtree that is known to hold only inline content — the header
 * title/authors/affiliations fields, which are single- or few-line strings and
 * must never gain block syntax.
 * @param {HTMLElement} root
 * @param {{multiline?: boolean}} [opts]
 * @returns {string}
 */
export function serializeInline(root, opts = {}) {
  if (!root) return '';
  const multiline = !!opts.multiline;
  let text = '';

  // A contenteditable that has had Enter pressed in it holds <div> or <br>
  // separators rather than a flat text run, so those become newlines here.
  for (const node of Array.from(root.childNodes)) {
    if (node.nodeType === Node.ELEMENT_NODE && isBlockTag(node.tagName)) {
      if (text && !text.endsWith('\n')) text += '\n';
      text += inline(Array.from(node.childNodes));
      text += '\n';
    } else {
      text += inline([node]);
    }
  }

  text = text.replace(/\u00a0/g, ' ').replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '');
  return multiline ? text : text.replace(/\s*\n+\s*/g, ' ');
}

/* ------------------------------------------------------------------ *
 * Block level
 * ------------------------------------------------------------------ */

const BLOCK_TAGS = new Set([
  'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'DIV', 'DL', 'FIGURE', 'FIGCAPTION',
  'FOOTER', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HEADER', 'HR', 'LI', 'MAIN', 'NAV',
  'OL', 'P', 'PRE', 'SECTION', 'TABLE', 'UL'
]);

function isBlockTag(tagName) {
  return BLOCK_TAGS.has(String(tagName || '').toUpperCase());
}

/**
 * Serialise a list of sibling nodes as block-level Markdown.
 * @param {Node[]} nodes
 * @param {string} indent prefix applied to every emitted line (list nesting)
 * @returns {string}
 */
function blocks(nodes, indent) {
  const parts = [];
  let looseText = [];

  const flushText = () => {
    const text = looseText.join('').trim();
    looseText = [];
    if (text) parts.push(prefixLines(text, indent));
  };

  for (const node of nodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      // Bare text between blocks (common right after the user presses Enter in a
      // contenteditable) is a paragraph in waiting.
      looseText.push(node.nodeValue || '');
      continue;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) continue;

    const verbatim = node.getAttribute && node.getAttribute(VERBATIM_ATTR);
    if (verbatim !== null && verbatim !== undefined) {
      looseText.push(verbatim);
      continue;
    }

    if (!isBlockTag(node.tagName)) {
      looseText.push(inline([node]));
      continue;
    }

    flushText();
    const block = blockElement(node, indent);
    if (block) parts.push(block);
  }

  flushText();
  return parts.filter(Boolean).join('\n\n');
}

/** Serialise one block-level element. */
function blockElement(node, indent) {
  const tag = node.tagName.toUpperCase();

  switch (tag) {
    case 'H1': case 'H2': case 'H3': case 'H4': case 'H5': case 'H6': {
      const level = Number(tag[1]);
      const text = inline(Array.from(node.childNodes)).trim();
      return text ? prefixLines(`${'#'.repeat(level)} ${text}`, indent) : '';
    }

    case 'HR':
      return prefixLines('---', indent);

    case 'PRE': {
      const code = node.querySelector('code');
      const body = (code || node).textContent || '';
      const lang = code ? languageOf(code) : '';
      return prefixLines('```' + lang + '\n' + body.replace(/\n$/, '') + '\n```', indent);
    }

    case 'BLOCKQUOTE': {
      const inner = blocks(Array.from(node.childNodes), '');
      if (!inner.trim()) return '';
      return prefixLines(inner.split('\n').map((l) => (l ? `> ${l}` : '>')).join('\n'), indent);
    }

    case 'UL':
    case 'OL':
      return list(node, indent, tag === 'OL');

    case 'TABLE':
      return prefixLines(table(node), indent);

    case 'FIGURE':
    case 'DIV':
    case 'SECTION':
    case 'ARTICLE':
    case 'MAIN':
    case 'HEADER':
    case 'FOOTER':
    case 'ASIDE':
    case 'NAV': {
      // Structural wrappers carry no Markdown of their own. A <div> holding only
      // inline content is what a browser produces for a new line in a
      // contenteditable, so it becomes a paragraph; one holding blocks is
      // transparent.
      const kids = Array.from(node.childNodes);
      if (kids.some((k) => k.nodeType === Node.ELEMENT_NODE && isBlockTag(k.tagName))) {
        return blocks(kids, indent);
      }
      const text = inline(kids).trim();
      return text ? prefixLines(text, indent) : '';
    }

    case 'P':
    default: {
      const text = inline(Array.from(node.childNodes)).replace(/\s+$/, '');
      return text.trim() ? prefixLines(text, indent) : '';
    }
  }
}

/** `class="language-js"` -> `js`. */
function languageOf(codeEl) {
  const match = /(?:^|\s)language-([\w+-]+)/.exec(codeEl.className || '');
  return match ? match[1] : '';
}

/** Serialise a `<ul>`/`<ol>`, recursing through nested lists. */
function list(node, indent, ordered) {
  const items = Array.from(node.children).filter((c) => c.tagName === 'LI');
  const lines = [];
  let index = Number(node.getAttribute('start')) || 1;

  for (const li of items) {
    const marker = ordered ? `${index}. ` : '- ';
    index += 1;

    // A task-list checkbox is markup marked's GFM mode generated; put the
    // `[ ]` / `[x]` back rather than serialising an <input>.
    let task = '';
    const box = li.querySelector(':scope > input[type="checkbox"]');
    if (box) {
      task = box.checked ? '[x] ' : '[ ] ';
      box.remove();
    }

    const nested = Array.from(li.children).filter((c) => c.tagName === 'UL' || c.tagName === 'OL');
    const own = Array.from(li.childNodes).filter((c) => !nested.includes(c));
    const body = blocks(own, '').trim() || inline(own).trim();

    const pad = ' '.repeat(marker.length);
    const wrapped = body
      ? body.split('\n').map((line, i) => (i === 0 ? line : pad + line)).join('\n')
      : '';
    lines.push(`${marker}${task}${wrapped}`);

    for (const sub of nested) {
      const subText = list(sub, pad, sub.tagName === 'OL');
      if (subText) lines.push(subText);
    }
  }

  return prefixLines(lines.join('\n'), indent);
}

/** Serialise a `<table>` as a GFM pipe table. */
function table(node) {
  const rows = Array.from(node.querySelectorAll('tr'));
  if (!rows.length) return '';

  const cellsOf = (tr) => Array.from(tr.children)
    .filter((c) => c.tagName === 'TD' || c.tagName === 'TH')
    .map((c) => inline(Array.from(c.childNodes)).replace(/\|/g, '\\|').replace(/\n+/g, ' ').trim());

  const head = cellsOf(rows[0]);
  const width = head.length || 1;

  const aligns = Array.from(rows[0].children).map((c) => {
    const a = (c.getAttribute('align') || c.style.textAlign || '').toLowerCase();
    if (a === 'center') return ':---:';
    if (a === 'right') return '---:';
    if (a === 'left') return ':---';
    return '---';
  });
  while (aligns.length < width) aligns.push('---');

  const lines = [
    `| ${head.join(' | ')} |`,
    `| ${aligns.slice(0, width).join(' | ')} |`
  ];

  for (const tr of rows.slice(1)) {
    const cells = cellsOf(tr);
    while (cells.length < width) cells.push('');
    lines.push(`| ${cells.slice(0, width).join(' | ')} |`);
  }

  return lines.join('\n');
}

/** Add `indent` to every non-empty line. */
function prefixLines(text, indent) {
  if (!indent) return text;
  return text.split('\n').map((line) => (line ? indent + line : line)).join('\n');
}

/* ------------------------------------------------------------------ *
 * Inline level
 * ------------------------------------------------------------------ */

/**
 * Serialise a run of inline nodes.
 * @param {Node[]} nodes
 * @returns {string}
 */
function inline(nodes) {
  let out = '';
  for (const node of nodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      out += escapeText(node.nodeValue || '');
      continue;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) continue;

    const verbatim = node.getAttribute && node.getAttribute(VERBATIM_ATTR);
    if (verbatim !== null && verbatim !== undefined) {
      out += verbatim;
      continue;
    }

    out += inlineElement(node);
  }
  return out;
}

function inlineElement(node) {
  const tag = node.tagName.toUpperCase();
  const kids = () => inline(Array.from(node.childNodes));

  switch (tag) {
    case 'BR':
      // `marked` runs with `breaks: true`, so one newline is one <br>.
      return '\n';

    case 'STRONG': case 'B': {
      const text = kids();
      return text.trim() ? `**${text}**` : text;
    }

    case 'EM': case 'I': {
      const text = kids();
      return text.trim() ? `*${text}*` : text;
    }

    case 'DEL': case 'S': case 'STRIKE': {
      const text = kids();
      return text.trim() ? `~~${text}~~` : text;
    }

    case 'CODE': {
      // Backticks inside inline code need a longer fence than the content uses.
      const text = node.textContent || '';
      const longest = (text.match(/`+/g) || []).reduce((n, run) => Math.max(n, run.length), 0);
      const fence = '`'.repeat(longest + 1);
      const pad = /^`|`$/.test(text) ? ' ' : '';
      return `${fence}${pad}${text}${pad}${fence}`;
    }

    case 'A': {
      const href = node.getAttribute('href') || '';
      const text = kids();
      return href ? `[${text}](${href})` : text;
    }

    case 'IMG': {
      const src = node.getAttribute('src') || '';
      const alt = node.getAttribute('alt') || '';
      return `![${alt}](${src})`;
    }

    case 'SPAN': {
      // The font-size spans the hover menu writes are the one piece of raw HTML
      // the app authors itself, so they go back out as raw HTML.
      if (RAW_INLINE_CLASSES.some((c) => node.classList.contains(c))) {
        return `<span class="${node.className}" style="${node.getAttribute('style') || ''}">${kids()}</span>`;
      }
      return kids();
    }

    default:
      // Unknown inline wrapper (a paste artefact such as <font>): keep the words,
      // drop the wrapper.
      return kids();
  }
}

/**
 * Normalise a text run on its way back into Markdown source.
 *
 * Note what this deliberately does NOT do: escape Markdown punctuation. The
 * obvious implementation backslash-escapes every `*`, `[`, `#` and so on, which
 * is correct for a pure WYSIWYG editor \u2014 and it would make typing Markdown into
 * the canvas impossible, because `**bold**` would come straight back out as
 * `\*\*bold\*\*` and never render. Live editing here is Markdown-first: what the
 * user types is source, so it is preserved as source.
 *
 * The trade is that prose which legitimately contains `**` or `_ _` will be
 * reinterpreted the next time the block re-renders. The raw-source editor
 * (double-click a block) is the escape hatch: backslashes typed there survive,
 * because they are already part of the source.
 *
 * The non-breaking spaces browsers insert while editing are folded back to
 * ordinary spaces \u2014 otherwise every edited line slowly fills with U+00A0 and
 * word wrapping stops working on the printed sheet.
 */
function escapeText(text) {
  return String(text).replace(/\u00a0/g, ' ');
}
