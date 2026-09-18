/**
 * data.js — factories, constants and the default poster document.
 *
 * This module is the only place that knows what a *fresh* poster looks like. Everything it
 * returns is plain, deep-cloneable JSON data (no functions, no Date instances, no DOM nodes)
 * so `structuredClone()` in posterState and `JSON.stringify()` in storage both work verbatim.
 */

/** Monotonic counter so two ids minted in the same millisecond can never collide. */
let uidCounter = 0;

/**
 * Generate a stable, unique id string.
 * @param {string} [prefix='blk'] Short namespace, e.g. 'blk' or 'col'.
 * @returns {string} e.g. 'blk_l3k2x9_7'
 */
export function uid(prefix = 'blk') {
  uidCounter += 1;
  const stamp = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 7);
  return `${prefix}_${stamp}${rand}${uidCounter.toString(36)}`;
}

/**
 * Font stacks offered in the Global Styles picker. Each `value` is a complete CSS
 * font-family list whose first entry is a Google Font loaded in index.html and whose tail
 * degrades to system fonts, so the app still looks intentional with no network.
 * @type {ReadonlyArray<{label: string, value: string}>}
 */
export const FONT_STACKS = [
  {
    label: 'Inter (modern sans)',
    value: "'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif"
  },
  {
    label: 'Source Serif 4 (academic serif)',
    value: "'Source Serif 4', 'Iowan Old Style', Georgia, 'Times New Roman', serif"
  },
  {
    label: 'Helvetica / Arial (neo-grotesque)',
    value: "'Helvetica Neue', Helvetica, Arial, 'Liberation Sans', sans-serif"
  },
  {
    label: 'Georgia (bookish serif)',
    value: "Georgia, Cambria, 'Times New Roman', Times, serif"
  },
  {
    label: 'Palatino (humanist serif)',
    value: "'Palatino Linotype', Palatino, 'Book Antiqua', 'URW Palladio L', serif"
  },
  {
    label: 'Segoe UI / System UI',
    value: "system-ui, 'Segoe UI', Roboto, 'Noto Sans', Ubuntu, sans-serif"
  },
  {
    label: 'Avenir / Nunito (geometric sans)',
    value: "'Avenir Next', Avenir, 'Nunito Sans', 'Century Gothic', sans-serif"
  },
  {
    label: 'Optima (calm humanist)',
    value: "Optima, 'Gill Sans', 'Gill Sans MT', Candara, sans-serif"
  },
  {
    label: 'Charter / Bitstream (print serif)',
    value: "Charter, 'Bitstream Charter', 'Sitka Text', Cambria, serif"
  },
  {
    label: 'JetBrains Mono (technical mono)',
    value: "'JetBrains Mono', 'SFMono-Regular', Consolas, 'Liberation Mono', monospace"
  }
];

/**
 * One-click look-and-feel presets. Each entry carries a partial state patch limited to the
 * `style` branch so applying one never disturbs content, layout or per-block overrides.
 * @type {ReadonlyArray<{label: string, patch: {style: Object}}>}
 */
export const THEME_PRESETS = [
  {
    label: 'Ocean Academic',
    patch: {
      style: {
        fontFamily: "'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif",
        headingColor: '#0f3057',
        bodyColor: '#1c2330',
        accentColor: '#2f7ac9',
        blockBg: '#ffffff',
        blockOpacity: 1,
        blockBorderColor: '#c9d6e8',
        blockRadiusIn: 0.12,
        blockPaddingIn: 0.3,
        headerBg: '#0f3057',
        headerTextColor: '#dbe8f7',
        titleColor: '#ffffff',
        sectionHeaderBg: '#0f3057',
        sectionHeaderColor: '#ffffff',
        showBlockBorders: true
      }
    }
  },
  {
    label: 'Warm Serif',
    patch: {
      style: {
        fontFamily: "'Source Serif 4', 'Iowan Old Style', Georgia, 'Times New Roman', serif",
        headingColor: '#5b2118',
        bodyColor: '#2b2320',
        accentColor: '#b4632a',
        blockBg: '#fffaf3',
        blockOpacity: 1,
        blockBorderColor: '#e4d2bd',
        blockRadiusIn: 0.16,
        blockPaddingIn: 0.32,
        headerBg: '#5b2118',
        headerTextColor: '#f4e3d2',
        titleColor: '#fff6ea',
        sectionHeaderBg: '#5b2118',
        sectionHeaderColor: '#f4e3d2',
        showBlockBorders: true
      }
    }
  },
  {
    label: 'High Contrast Mono',
    patch: {
      style: {
        fontFamily: "'Helvetica Neue', Helvetica, Arial, 'Liberation Sans', sans-serif",
        headingColor: '#000000',
        bodyColor: '#111111',
        accentColor: '#000000',
        blockBg: '#ffffff',
        blockOpacity: 1,
        blockBorderColor: '#000000',
        blockRadiusIn: 0,
        blockPaddingIn: 0.3,
        headerBg: '#000000',
        headerTextColor: '#ffffff',
        titleColor: '#ffffff',
        sectionHeaderBg: '#000000',
        sectionHeaderColor: '#ffffff',
        showBlockBorders: true
      }
    }
  },
  {
    label: 'Minimal Slate',
    patch: {
      style: {
        fontFamily: "system-ui, 'Segoe UI', Roboto, 'Noto Sans', Ubuntu, sans-serif",
        headingColor: '#26303b',
        bodyColor: '#39434f',
        accentColor: '#5c7d99',
        blockBg: '#ffffff',
        blockOpacity: 1,
        blockBorderColor: '#dde3e9',
        blockRadiusIn: 0.08,
        blockPaddingIn: 0.34,
        headerBg: '#f2f5f8',
        headerTextColor: '#4a5765',
        titleColor: '#1d2630',
        sectionHeaderBg: '#e7ecf1',
        sectionHeaderColor: '#26303b',
        showBlockBorders: false
      }
    }
  },
  {
    label: 'Forest Field Study',
    patch: {
      style: {
        fontFamily: "'Avenir Next', Avenir, 'Nunito Sans', 'Century Gothic', sans-serif",
        headingColor: '#12402f',
        bodyColor: '#1f2a24',
        accentColor: '#3f8f5f',
        blockBg: '#fbfdfa',
        blockOpacity: 1,
        blockBorderColor: '#c6dccb',
        blockRadiusIn: 0.14,
        blockPaddingIn: 0.3,
        headerBg: '#12402f',
        headerTextColor: '#d8ecdd',
        titleColor: '#ffffff',
        sectionHeaderBg: '#12402f',
        sectionHeaderColor: '#d8ecdd',
        showBlockBorders: true
      }
    }
  },
  {
    label: 'Crimson Classic',
    patch: {
      style: {
        fontFamily: "Georgia, Cambria, 'Times New Roman', Times, serif",
        headingColor: '#6b1220',
        bodyColor: '#241a1c',
        accentColor: '#a3283c',
        blockBg: '#fffdfd',
        blockOpacity: 1,
        blockBorderColor: '#e6cdd2',
        blockRadiusIn: 0.1,
        blockPaddingIn: 0.32,
        headerBg: '#6b1220',
        headerTextColor: '#f6dfe3',
        titleColor: '#ffffff',
        sectionHeaderBg: '#6b1220',
        sectionHeaderColor: '#f6dfe3',
        showBlockBorders: true
      }
    }
  }
];

/**
 * Starter markdown used for brand new blocks. Deliberately exercises every renderer path:
 * headings, bullets, bold/italic, a table, inline math and a display equation.
 * @type {string}
 */
export const MARKDOWN_PLACEHOLDER = [
  '## New Section',
  '',
  'Replace this text with your content. **Double-click** the block on the canvas to edit it',
  'inline, or use the *Selected Block* inspector in the left panel.',
  '',
  '- Bullet lists keep dense poster copy scannable',
  '- Use **bold** for the claim and plain text for the evidence',
  '- Inline math renders too: $E=mc^2$',
  '',
  '| Condition | Metric | Value |',
  '| --- | --- | --- |',
  '| Baseline | AUROC | 0.812 |',
  '| Proposed | AUROC | **0.894** |',
  '',
  'A display equation gets its own centred line:',
  '',
  '$$\\hat{y} = \\sigma\\left(\\sum_{i=1}^{n} w_i x_i + b\\right)$$',
  ''
].join('\n');

/**
 * Fresh per-block style override object. Every entry is `null` (= inherit from global style)
 * except `align`, which is a real value because text alignment has no meaningful global.
 * @returns {Object} block style override
 */
function defaultBlockStyle() {
  return {
    bg: null,
    opacity: null,
    fontScale: null,
    // Explicit body size for this block in typographic points (72 pt = 1 in on
    // the printed sheet). Null keeps the inherited size, which is derived from
    // style.baseFontIn — the two are alternatives, not layers, so a block can be
    // pinned to "24 pt" without the global body size moving it afterwards.
    fontPt: null,
    textColor: null,
    headingColor: null,
    borderColor: null,
    showBorder: null,
    paddingIn: null,
    radiusIn: null,
    align: 'left'
  };
}

/**
 * Every content type a LEAF block may take. Shared by the store, the migrator,
 * the renderer and the inspector so a new type only has to be added once.
 * @type {ReadonlyArray<'markdown'|'image'|'section'>}
 */
export const BLOCK_TYPES = ['markdown', 'image', 'section'];

/**
 * Create an `<Image>` descriptor.
 *
 * `caption` is Markdown rendered directly beneath the picture and shares the
 * sub-block's height budget with it, so a figure and its caption always stay
 * inside the container they were given.
 *
 * @param {string} [path=''] Relative path or URL. Always persisted, even alongside a dataUrl.
 * @param {Object} [overrides={}] Partial image fields ({dataUrl, alt, fit, caption}).
 * @returns {{path: string, dataUrl: (string|null), alt: string, fit: string, caption: string}}
 */
export function createImage(path = '', overrides = {}) {
  return {
    path: typeof path === 'string' ? path : '',
    dataUrl: null,
    alt: '',
    fit: 'contain',
    caption: '',
    ...overrides
  };
}

/**
 * Create a markdown LEAF block.
 * @param {Object} [overrides={}] Partial leaf fields; `style` is merged onto the null defaults.
 * @returns {Object} leaf block
 */
export function createLeaf(overrides = {}) {
  const { style, image, ...rest } = overrides;
  return {
    id: uid('blk'),
    kind: 'leaf',
    ratio: 1,
    fixedIn: null,
    type: 'markdown',
    label: 'New Block',
    markdown: MARKDOWN_PLACEHOLDER,
    image: image ? createImage(image.path || '', image) : createImage(''),
    style: { ...defaultBlockStyle(), ...(style || {}) },
    ...rest
  };
}

/**
 * Create an image LEAF block.
 * @param {string} [path=''] Image path recorded on the block's image descriptor.
 * @param {Object} [overrides={}] Partial leaf fields; `image` is merged onto the descriptor.
 * @returns {Object} leaf block with type 'image'
 */
export function createImageLeaf(path = '', overrides = {}) {
  const { image, ...rest } = overrides;
  return createLeaf({
    label: 'Figure',
    type: 'image',
    markdown: '',
    image: createImage(path, image || {}),
    ...rest
  });
}

/**
 * Create a SECTION HEADER leaf — a short banner used to name a run of blocks.
 *
 * Section headers deliberately carry no `fixedIn`: the renderer gives every one
 * of them the same `style.sectionHeaderIn` height so bands line up across all
 * columns. Set `fixedIn` on an individual block to opt out.
 *
 * @param {string} [text='Section'] Banner text.
 * @param {Object} [overrides={}] Partial leaf fields.
 * @returns {Object} leaf block with type 'section'
 */
export function createSectionLeaf(text = 'Section', overrides = {}) {
  return createLeaf({
    label: '',
    type: 'section',
    markdown: typeof text === 'string' ? text : 'Section',
    ...overrides
  });
}

/**
 * Create a SPLIT block containing the given children.
 * @param {string} orientation 'rows' (stacked) or 'cols' (side by side).
 * @param {Array<Object>} children Child blocks, in visual order.
 * @param {number} [gapIn=0.25] Gap between children, in inches.
 * @returns {Object} split block
 */
export function createSplit(orientation, children, gapIn = 0.25) {
  return {
    id: uid('blk'),
    kind: 'split',
    ratio: 1,
    fixedIn: null,
    orientation: orientation === 'cols' ? 'cols' : 'rows',
    gapIn: typeof gapIn === 'number' && isFinite(gapIn) ? gapIn : 0.25,
    children: Array.isArray(children) ? children.slice() : []
  };
}

/**
 * Create a top-level column.
 * @param {string} label Human label shown in the tree and the Columns section.
 * @param {number|null} widthIn Fixed width in inches, or null to auto-share leftover space.
 * @param {Object} root Root block of the column (leaf or split).
 * @returns {{id: string, label: string, widthIn: (number|null), root: Object}}
 */
export function createColumn(label, widthIn, root) {
  return {
    id: uid('col'),
    label: label || 'Column',
    widthIn: typeof widthIn === 'number' && isFinite(widthIn) ? widthIn : null,
    root: root || createLeaf({ label: 'Section' })
  };
}

/**
 * Fresh copy of the global style branch. Returned by value so callers can mutate freely.
 * @returns {Object} global style object
 */
export function defaultStyle() {
  return {
    fontFamily: "'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif",
    fontScale: 1,
    baseFontIn: 0.34,

    // Proportional scale for the CONTENT of section blocks — Markdown h1–h4 and
    // paragraph text — on top of fontScale. Same idea and same 0.4–2.5 range as
    // header.titleScale / authorsScale / affiliationsScale, so the four sliders
    // in the sidebar behave identically; canvas.js turns this into one CSS
    // custom property and typography.css multiplies the prose sizes by it.
    sectionScale: 1,
    headingColor: '#0f3057',
    bodyColor: '#1c2330',
    accentColor: '#2f7ac9',
    blockBg: '#ffffff',
    blockOpacity: 1,
    blockBorderColor: '#c9d6e8',
    blockRadiusIn: 0.12,
    blockPaddingIn: 0.3,
    headerBg: '#0f3057',
    headerTextColor: '#ffffff',
    titleColor: '#ffffff',
    showBlockBorders: true,

    // Section-header bands. The height is global on purpose: every band on the
    // poster gets exactly this many inches, so they align across columns no
    // matter how much text each one holds (auto-fit shrinks the text instead).
    sectionHeaderIn: 0.9,
    sectionHeaderBg: '#0f3057',
    sectionHeaderColor: '#ffffff'
  };
}

/* ------------------------------------------------------------------------------------------
 * Default document content
 *
 * The filler below is a plausible (entirely fictional) multimodal-retinal-imaging study. It
 * exists so the very first paint shows a poster somebody could actually present: real prose
 * rhythm, a table, a KaTeX display equation and figure placeholders.
 * ---------------------------------------------------------------------------------------- */

const INTRO_MD = [
  '## Background',
  '',
  'Diabetic retinopathy (DR) is the leading cause of preventable blindness in working-age',
  'adults, yet **more than half** of incident cases in community screening programmes are',
  'detected only after irreversible neurovascular damage has occurred. Colour fundus',
  'photography remains the screening workhorse because it is cheap and fast, but the earliest',
  'pathology — capillary drop-out and photoreceptor thinning — is largely invisible to it.',
  '',
  'Optical coherence tomography (OCT) resolves that structure directly, and OCT angiography',
  '(OCT-A) adds perfusion. The two modalities are, however, rarely fused: acquisitions are',
  'unpaired, spatially misregistered, and OCT is missing for roughly a third of patients in',
  'routine clinics.',
  '',
  '### Why fusion is hard',
  '',
  '- **Missing modalities.** Naive concatenation collapses when OCT is absent at inference.',
  '- **Registration drift.** Fundus and OCT en-face maps disagree by $1.2$–$3.4^\\circ$ of',
  '  visual angle after standard affine alignment.',
  '- **Label scarcity.** Only $8.1\\%$ of the pooled cohort carries lesion-level annotation.',
  '- **Domain shift.** Camera model alone explains $11\\%$ of baseline AUROC variance.',
  '',
  'We ask whether a *cross-modal attention* encoder, trained with modality dropout, can recover',
  'the diagnostic signal of paired imaging while degrading gracefully to fundus-only input.'
].join('\n');

const OBJECTIVES_MD = [
  '## Objectives',
  '',
  '1. Learn a **shared retinal representation** from unpaired fundus and OCT volumes without',
  '   lesion-level supervision.',
  '2. Quantify referable-DR detection against a strong fundus-only convolutional baseline on',
  '   three external cohorts.',
  '3. Show that accuracy is **retained under modality dropout**, the deployment condition that',
  '   matters for community screening.',
  '4. Produce clinician-legible attention maps that agree with graded lesion locations.',
  '',
  '### Primary hypothesis',
  '',
  'Cross-modal attention improves early-stage (Grade 1–2) sensitivity by $\\geq 8$ points at a',
  'fixed specificity of $0.90$, with no loss on Grade 3–4 disease.',
  '',
  '> **Endpoint.** Area under the ROC curve for referable DR, external validation, with',
  '> $95\\%$ bootstrap confidence intervals over $2{,}000$ resamples.'
].join('\n');

const METHODS_MD = [
  '## Methods',
  '',
  '### Cohorts',
  '',
  'We pooled **41,806 eyes** from 23,914 patients across four screening services (2016–2024).',
  'Grading followed the ICDR scale, adjudicated by two retina specialists with a third breaking',
  'ties; inter-grader agreement was $\\kappa = 0.84$. Training used two internal sites; the two',
  'remaining sites were held out entirely for external validation.',
  '',
  '### Architecture',
  '',
  '- Two ViT-B/16 encoders, one per modality, initialised from a self-supervised retinal',
  '  checkpoint and **not** weight-tied.',
  '- A six-layer cross-attention bridge in which fundus tokens query OCT tokens, and a learned',
  '  *null modality* token substitutes for absent OCT.',
  '- **Modality dropout** at $p = 0.35$ during training, so the fundus path is never allowed to',
  '  become dependent on its partner.',
  '- A lightweight ordinal head over the five ICDR grades.',
  '',
  '### Objective',
  '',
  'Training minimises an ordinal cross-entropy term plus an alignment term that pulls matched',
  'embeddings together and pushes mismatched pairs apart:',
  '',
  '$$\\mathcal{L} = \\mathcal{L}_{\\mathrm{ord}} + \\lambda \\, \\mathbb{E}_{(f,o)}',
  '\\Big[ 1 - \\cos\\big(z_f, z_o\\big) \\Big] + \\beta \\lVert \\theta \\rVert_2^2$$',
  '',
  'with $\\lambda = 0.4$ and $\\beta = 10^{-4}$ chosen on the internal validation split. Images',
  'were resized to $512 \\times 512$, CLAHE-normalised, and augmented with rotation, colour',
  'jitter and simulated media opacity. Optimisation used AdamW, cosine decay from $3\\times',
  '10^{-4}$, batch size 32, for 120 epochs on 4 A100 GPUs (≈ 61 GPU-hours).'
].join('\n');

const RESULTS_MD = [
  '## Results',
  '',
  'Cross-modal attention beat the fundus-only baseline on **every external cohort**, and the',
  'margin was largest exactly where screening is hardest: early, Grade 1–2 disease.',
  '',
  '| Model | Input | AUROC (ext.) | Sens. @ 0.90 Spec. | Grade 1–2 Sens. |',
  '| --- | --- | --- | --- | --- |',
  '| ResNet-50 | Fundus | 0.887 | 0.741 | 0.512 |',
  '| ViT-B/16 | Fundus | 0.901 | 0.768 | 0.549 |',
  '| Late fusion | Fundus + OCT | 0.923 | 0.812 | 0.604 |',
  '| **Ours** | Fundus + OCT | **0.948** | **0.871** | **0.683** |',
  '| **Ours** | Fundus only | **0.932** | **0.844** | **0.641** |',
  '',
  '### Key numbers',
  '',
  '- **+4.7 AUROC points** over the strongest single-modality model on external data',
  '  ($p < 0.001$, DeLong).',
  '- **+13.4 points** of Grade 1–2 sensitivity — the primary hypothesis is met.',
  '- Dropping OCT at inference costs only $1.6$ points, versus $6.9$ for late fusion.',
  '- Calibration improved as well: expected calibration error fell from $0.061$ to',
  '',
  '$$\\mathrm{ECE} = \\sum_{b=1}^{B} \\frac{|B_b|}{N} \\big| \\mathrm{acc}(B_b) -',
  '\\mathrm{conf}(B_b) \\big| = 0.028$$',
  '',
  'Attention maps localised haemorrhages and venous beading with a mean Dice of $0.57$ against',
  'expert masks, without ever seeing a pixel-level label.'
].join('\n');

const CONCLUSIONS_MD = [
  '## Conclusions',
  '',
  '- Cross-modal attention with **modality dropout** delivers paired-imaging accuracy while',
  '  staying deployable on fundus-only pipelines.',
  '- Gains concentrate in **early disease**, the regime where a screening programme actually',
  '  changes outcomes.',
  '- Attention maps are spatially faithful enough to support grader review, which matters far',
  '  more for adoption than a headline AUROC.',
  '',
  '### Limitations',
  '',
  'All cohorts are retrospective, and three of four sites use the same camera vendor.',
  'Prospective evaluation in a live screening service is underway ($n = 4{,}500$, enrolling).',
  '',
  '### Next steps',
  '',
  '1. Add fluorescein angiography as a third stream.',
  '2. Distil the bridge into a 12M-parameter model for point-of-care hardware.',
  '3. Release weights and the pre-processing pipeline under an open licence.'
].join('\n');

const REFERENCES_MD = [
  '## References',
  '',
  '1. Okonkwo A, Berger L, *et al.* Deep learning for diabetic retinopathy screening: a',
  '   ten-year review. **Lancet Digit Health** 2023;5(4):e211–e224.',
  '2. Vasquez M, Lin H. Cross-modal attention for medical image fusion. **MICCAI** 2022;',
  '   LNCS 13435:118–128.',
  '3. Rahman S, Petrov D, Iyer K. Modality dropout as regularisation. **NeurIPS** 2021;',
  '   34:9012–9024.',
  '4. Early Treatment Diabetic Retinopathy Study Group. Grading standards, report No. 10.',
  '   **Ophthalmology** 1991;98(5):786–806.',
  '5. Chen Y, Whitfield R. Calibration of clinical risk models. **JAMA Netw Open**',
  '   2024;7(2):e2355012.',
  '',
  '**Contact** · a.okonkwo@wexbridge.ac.uk · Code and weights: `github.com/wexbridge-vision/xmodal-dr`'
].join('\n');

/**
 * Build the default 48x36in conference poster: header band plus three columns
 * (Introduction/Objectives, Methods/Figure, Results/Figures/Conclusions/References).
 * @returns {Object} a complete, self-contained poster state
 */
export function defaultPoster() {
  const now = new Date().toISOString();

  const columnOne = createColumn(
    'Column 1',
    12,
    createSplit(
      'rows',
      [
        createLeaf({
          label: 'Introduction',
          ratio: 1.25,
          markdown: INTRO_MD
        }),
        createLeaf({
          label: 'Objectives',
          ratio: 1,
          markdown: OBJECTIVES_MD
        })
      ],
      0.3
    )
  );

  const columnTwo = createColumn(
    'Column 2',
    12,
    createSplit(
      'rows',
      [
        createLeaf({
          label: 'Methods',
          ratio: 1.6,
          markdown: METHODS_MD
        }),
        createImageLeaf('./assets/placeholders/sample-chart.svg', {
          label: 'Figure 1 · Cross-modal architecture and training signal',
          ratio: 1,
          image: {
            alt: 'Schematic of the dual-encoder cross-attention model with modality dropout',
            fit: 'contain'
          },
          style: { align: 'center' }
        })
      ],
      0.3
    )
  );

  const columnThree = createColumn(
    'Column 3',
    null,
    createSplit(
      'rows',
      [
        // Column 3 is deliberately built the other way round from columns 1–2:
        // a section band names the run, and the blocks under it carry no
        // heading of their own. Both idioms are valid; the starter poster shows
        // each so the pattern is discoverable.
        createSectionLeaf('Results'),
        createLeaf({
          label: '',
          ratio: 1.65,
          markdown: RESULTS_MD
        }),
        createSplit(
          'cols',
          [
            createImageLeaf('./assets/placeholders/sample-chart.svg', {
              label: '',
              ratio: 1,
              image: {
                alt: 'ROC curves for the four models on the two external validation cohorts',
                fit: 'contain',
                caption: '**Figure 2.** External ROC curves. Cross-modal attention reaches '
                  + '$\\mathrm{AUROC}=0.94$ on both validation cohorts.'
              },
              style: { align: 'center' }
            }),
            createImageLeaf('./assets/placeholders/sample-photo.svg', {
              label: '',
              ratio: 1,
              image: {
                alt: 'Fundus photograph with model attention overlaid on haemorrhage sites',
                fit: 'cover',
                caption: '**Figure 3.** Attention overlay concentrates on dot haemorrhages '
                  + 'and venous beading.'
              },
              style: { align: 'center' }
            })
          ],
          0.28
        ),
        createLeaf({
          label: 'Conclusions',
          ratio: 1.1,
          markdown: CONCLUSIONS_MD
        }),
        createLeaf({
          label: 'References & Contact',
          ratio: 0.85,
          markdown: REFERENCES_MD,
          style: { fontScale: 0.82 }
        })
      ],
      0.3
    )
  );

  return {
    meta: {
      name: 'Untitled_Poster',
      version: 1,
      created: now,
      modified: now,
      forkedFrom: null
    },
    canvas: {
      widthIn: 48,
      heightIn: 36,
      margins: { top: 0.5, right: 0.5, bottom: 0.5, left: 0.5 },
      columnGapIn: 0.4,
      rowGapIn: 0.4,
      background: {
        color: '#eef2f9',
        useImage: false,
        imagePath: './assets/placeholders/texture-grid.svg',
        imageDataUrl: null,
        imageOpacity: 0.25,
        imageFit: 'cover'
      }
    },
    style: defaultStyle(),
    header: {
      heightIn: 4,
      logoLeft: {
        widthIn: 2,
        image: createImage('./assets/placeholders/logo-left.svg', {
          alt: 'Wexbridge Institute of Vision Science logo',
          fit: 'contain'
        })
      },
      logoRight: {
        widthIn: 2,
        image: createImage('./assets/placeholders/logo-right.svg', {
          alt: 'Northfield University Hospitals NHS Trust logo',
          fit: 'contain'
        })
      },
      title:
        'Cross-Modal Attention Between Fundus Photography and OCT Improves Early Detection of Diabetic Retinopathy',
      authors:
        'A. Okonkwo¹, M. Vasquez², S. Rahman¹˒³, L. Berger², K. Iyer¹',
      affiliations: [
        '¹ Wexbridge Institute of Vision Science, Department of Computational Ophthalmology, Wexbridge, UK',
        '² Northfield University Hospitals NHS Trust, Retinal Screening Programme, Northfield, UK',
        '³ Centre for Medical Image Computing, University of St. Aldwyn, St. Aldwyn, UK'
      ].join('\n'),
      titleScale: 1,
      authorsScale: 1,
      affiliationsScale: 1,
      align: 'center'
    },
    columns: [columnOne, columnTwo, columnThree]
  };
}
