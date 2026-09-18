/**
 * templates.config.js — the quick-start poster templates offered in the top bar.
 *
 * This file is pure configuration: it holds no DOM code and imports nothing but
 * the factories in data.js, so adding a sixth template is a matter of copying an
 * entry and changing values. `components/templatePicker.js` renders whatever is
 * in `POSTER_TEMPLATES` and applies it through the store.
 *
 * SCHEMA — every entry is:
 *
 *   {
 *     id:      string   stable key, persisted as `meta.templateId`
 *     label:   string   name shown on the chooser card
 *     useCase: string   one line of "what this is for"
 *     size:    string   human-readable sheet size, shown on the card
 *     blurb:   string   one sentence describing the look
 *     swatch:  string[] two or three hex colours for the card's colour dots
 *     build(): {canvas, style, header, columns}
 *   }
 *
 * `build()` returns a partial poster document. It MUST return freshly created
 * blocks (via the data.js factories) rather than a shared constant, because each
 * application mints new block ids — returning a module-level object would let two
 * applications of the same template share ids and corrupt the tree.
 *
 * The returned branches are merged over `defaultPoster()` in
 * `buildTemplateState()`, so a template only has to state what differs. Anything
 * it omits — margins, per-block overrides, the schema version — keeps the
 * app-wide default and stays valid for the migrator.
 */

import {
  createColumn,
  createImageLeaf,
  createLeaf,
  createSectionLeaf,
  createSplit,
  defaultPoster,
  defaultStyle
} from './data.js';

/** Millimetres to inches — the document model is inch-based throughout. */
const mm = (value) => Number((value / 25.4).toFixed(4));

/** Font stacks reused from the Global Styles picker so the select stays in sync. */
const SANS = "'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif";
const SERIF = "'Source Serif 4', 'Iowan Old Style', Georgia, 'Times New Roman', serif";
const GEOMETRIC = "'Avenir Next', Avenir, 'Nunito Sans', 'Century Gothic', sans-serif";

/* ------------------------------------------------------------------ *
 * The templates
 * ------------------------------------------------------------------ */

/** @type {ReadonlyArray<object>} */
export const POSTER_TEMPLATES = [
  {
    id: 'modern-corporate',
    label: 'Modern Corporate',
    useCase: 'Conferences, business events',
    size: 'A4 · 210 × 297 mm',
    blurb: 'Clean corporate grid with geometric accent bands and a blue-to-orange palette.',
    swatch: ['#123a6d', '#f2761b', '#f4f7fb'],
    build() {
      return {
        canvas: {
          widthIn: mm(210),
          heightIn: mm(297),
          margins: { top: 0.4, right: 0.4, bottom: 0.4, left: 0.4 },
          columnGapIn: 0.28,
          rowGapIn: 0.28,
          background: {
            color: '#f4f7fb',
            useImage: false,
            imagePath: './assets/placeholders/texture-grid.svg',
            imageDataUrl: null,
            imageOpacity: 0.18,
            imageFit: 'cover'
          }
        },
        style: {
          fontFamily: SANS,
          baseFontIn: 0.085,
          headingColor: '#123a6d',
          bodyColor: '#22293a',
          accentColor: '#f2761b',
          blockBg: '#ffffff',
          blockBorderColor: '#d7e0ee',
          blockRadiusIn: 0.06,
          blockPaddingIn: 0.16,
          headerBg: '#123a6d',
          headerTextColor: '#dce8fa',
          titleColor: '#ffffff',
          showBlockBorders: true,
          sectionHeaderIn: 0.34,
          sectionHeaderBg: '#f2761b',
          sectionHeaderColor: '#ffffff'
        },
        header: {
          heightIn: 1.7,
          logoLeft: { widthIn: 0.9 },
          logoRight: { widthIn: 0.9 },
          title: 'Scaling Operations Without Scaling Headcount',
          authors: 'Annual Partner Summit · Keynote Track',
          affiliations: 'Thursday 14 March · 09:30–11:00 · Hall B, Riverside Centre',
          titleScale: 1,
          authorsScale: 1,
          affiliationsScale: 1,
          align: 'left'
        },
        columns: [
          createColumn('Main', null, createSplit('rows', [
            createSectionLeaf('The Brief'),
            createLeaf({
              label: '',
              ratio: 1.1,
              markdown: [
                'Three business units, one operating model. This session walks through the',
                'twelve-month programme that consolidated procurement, finance and delivery',
                'onto a single reporting spine.',
                '',
                '- **38%** less manual reconciliation',
                '- **6 weeks** saved per quarterly close',
                '- **One** source of truth for margin'
              ].join('\n')
            }),
            createSectionLeaf('Programme'),
            createLeaf({
              label: '',
              ratio: 1.2,
              markdown: [
                '| Phase | Focus | Outcome |',
                '| :--- | :--- | :--- |',
                '| Discover | Process mapping | Baseline metrics |',
                '| Design | Target operating model | Signed-off blueprint |',
                '| Deliver | Migration in waves | Zero downtime cutover |',
                '| Embed | Enablement | Self-serve reporting |'
              ].join('\n')
            }),
            createSectionLeaf('Speakers'),
            createLeaf({
              label: '',
              ratio: 0.8,
              markdown: [
                '**Dana Whitcombe** — Group Operations Director',
                '',
                '**Marcus Aldington** — Head of Financial Systems',
                '',
                '**Priya Nadarajah** — Programme Lead, Transformation'
              ].join('\n')
            }),
            createLeaf({
              label: '',
              ratio: 0.45,
              markdown: 'Register at **partners.example.com/summit** · #PartnerSummit',
              style: { align: 'center', bg: '#123a6d', textColor: '#ffffff', showBorder: false }
            })
          ], 0.22))
        ]
      };
    }
  },

  {
    id: 'creative-workshop',
    label: 'Creative Workshop',
    useCase: 'Art classes, design summits',
    size: 'US Letter · 8.5 × 11 in',
    blurb: 'Warm illustrative sheet with a textured ground, coral accents and a serif display face.',
    swatch: ['#ff6f5e', '#ffc93c', '#fff8e6'],
    build() {
      return {
        canvas: {
          widthIn: 8.5,
          heightIn: 11,
          margins: { top: 0.45, right: 0.45, bottom: 0.45, left: 0.45 },
          columnGapIn: 0.3,
          rowGapIn: 0.3,
          background: {
            color: '#fff8e6',
            // The shipped texture stands in for the hand-drawn ground: it is a
            // local asset, so the template still looks right with no network.
            useImage: true,
            imagePath: './assets/placeholders/texture-grid.svg',
            imageDataUrl: null,
            imageOpacity: 0.16,
            imageFit: 'tile'
          }
        },
        style: {
          fontFamily: SERIF,
          baseFontIn: 0.1,
          headingColor: '#b3341f',
          bodyColor: '#3a2410',
          accentColor: '#ff6f5e',
          blockBg: '#fffdf6',
          blockOpacity: 0.94,
          blockBorderColor: '#f0c98a',
          blockRadiusIn: 0.18,
          blockPaddingIn: 0.22,
          headerBg: '#ffc93c',
          headerTextColor: '#3a2410',
          titleColor: '#7a1f0d',
          showBlockBorders: true,
          sectionHeaderIn: 0.42,
          sectionHeaderBg: '#ff6f5e',
          sectionHeaderColor: '#fff8e6'
        },
        header: {
          heightIn: 2.4,
          logoLeft: { widthIn: 0 },
          logoRight: { widthIn: 1.1 },
          title: 'Make Something\nBy Hand',
          authors: 'A four-week evening studio in print, pattern and paper',
          affiliations: 'Tuesdays 18:30 · The Old Bindery, Mill Lane',
          titleScale: 1.15,
          authorsScale: 1,
          affiliationsScale: 1,
          align: 'center'
        },
        columns: [
          createColumn('Left', null, createSplit('rows', [
            createSectionLeaf('What we make'),
            createLeaf({
              label: '',
              ratio: 1,
              markdown: [
                '*Week one* — mark-making and monoprint',
                '',
                '*Week two* — cutting stencils, layering colour',
                '',
                '*Week three* — repeat pattern and registration',
                '',
                '*Week four* — binding the finished portfolio'
              ].join('\n')
            }),
            createImageLeaf('./assets/placeholders/sample-photo.svg', {
              label: '',
              ratio: 0.9,
              image: {
                alt: 'Studio bench with inked plates and rollers',
                fit: 'cover',
                caption: '*Everything is provided — bring an apron.*'
              },
              style: { align: 'center' }
            })
          ], 0.26)),
          createColumn('Right', null, createSplit('rows', [
            createSectionLeaf('Details'),
            createLeaf({
              label: '',
              ratio: 1,
              markdown: [
                '**No experience needed.** Twelve places per cohort, all materials included.',
                '',
                '> "I came for one evening and stayed for the whole term."',
                '',
                '£180 for four weeks · concessions available'
              ].join('\n')
            }),
            createLeaf({
              label: '',
              ratio: 0.5,
              markdown: 'Book at **oldbindery.example/studio**',
              style: { align: 'center', bg: '#ff6f5e', textColor: '#fff8e6', showBorder: false }
            })
          ], 0.26))
        ]
      };
    }
  },

  {
    id: 'music-festival',
    label: 'Music Festival',
    useCase: 'Live events, concerts',
    size: 'B2 · 500 × 700 mm',
    blurb: 'Near-black ground, neon type and a stacked line-up that reads from across the street.',
    swatch: ['#0d0d0d', '#39ff14', '#ff2fd0'],
    build() {
      return {
        canvas: {
          widthIn: mm(500),
          heightIn: mm(700),
          margins: { top: 0.8, right: 0.8, bottom: 0.8, left: 0.8 },
          columnGapIn: 0.4,
          rowGapIn: 0.5,
          background: {
            color: '#0D0D0D',
            useImage: false,
            imagePath: '',
            imageDataUrl: null,
            imageOpacity: 0.2,
            imageFit: 'cover'
          }
        },
        style: {
          fontFamily: GEOMETRIC,
          baseFontIn: 0.22,
          sectionScale: 1.1,
          headingColor: '#39ff14',
          bodyColor: '#f2f2f2',
          accentColor: '#ff2fd0',
          // Blocks are invisible panes: the line-up must read as type on black,
          // not as a set of cards, so the fill matches the sheet exactly.
          blockBg: '#0D0D0D',
          blockOpacity: 1,
          blockBorderColor: '#2a2a2a',
          blockRadiusIn: 0,
          blockPaddingIn: 0.15,
          headerBg: '#0D0D0D',
          headerTextColor: '#39ff14',
          titleColor: '#39ff14',
          showBlockBorders: false,
          sectionHeaderIn: 1,
          sectionHeaderBg: '#ff2fd0',
          sectionHeaderColor: '#0D0D0D'
        },
        header: {
          heightIn: 6.5,
          logoLeft: { widthIn: 0 },
          logoRight: { widthIn: 0 },
          title: 'NIGHTFALL\nFESTIVAL',
          authors: '23 – 25 AUGUST · HARBOUR YARDS',
          affiliations: 'THREE STAGES · FORTY ARTISTS · ONE WEEKEND',
          titleScale: 1.4,
          authorsScale: 1.2,
          affiliationsScale: 1,
          align: 'center'
        },
        columns: [
          createColumn('Line-up', null, createSplit('rows', [
            createSectionLeaf('FRIDAY'),
            createLeaf({
              label: '',
              ratio: 1,
              markdown: [
                '# VELVET STATIC',
                '## THE LONG NOW · KURO KURO',
                'Amber Tide · Palewater · Hessian Sun'
              ].join('\n'),
              style: { align: 'center' }
            }),
            createSectionLeaf('SATURDAY'),
            createLeaf({
              label: '',
              ratio: 1,
              markdown: [
                '# MIDNIGHT CARAVAN',
                '## SODA CHURCH · ATLAS FEVER',
                'Nine Volt Choir · Brine · Slow Cartography'
              ].join('\n'),
              style: { align: 'center' }
            }),
            createSectionLeaf('SUNDAY'),
            createLeaf({
              label: '',
              ratio: 1,
              markdown: [
                '# THE GRAND ELECTRIC',
                '## HOLLOW COAST · MARGIN WALK',
                'Feverdream · Ossuary Blue · Late Signal'
              ].join('\n'),
              style: { align: 'center' }
            }),
            createLeaf({
              label: '',
              ratio: 0.55,
              markdown: 'TICKETS · **nightfall.example** · WEEKEND CAMPING FROM £89',
              style: { align: 'center', textColor: '#ff2fd0' }
            })
          ], 0.45))
        ]
      };
    }
  },

  {
    id: 'minimalist-quote',
    label: 'Minimalist Quote',
    useCase: 'Modern decor, gallery prints',
    size: 'A3 · 297 × 420 mm',
    blurb: 'One serif sentence, stark black on white, surrounded by deliberate emptiness.',
    swatch: ['#111111', '#ffffff', '#8a8a8a'],
    build() {
      return {
        canvas: {
          widthIn: mm(297),
          heightIn: mm(420),
          // The whitespace IS the design, so the margins are unusually deep.
          margins: { top: 2.2, right: 1.6, bottom: 2.2, left: 1.6 },
          columnGapIn: 0,
          rowGapIn: 0.6,
          background: {
            color: '#ffffff',
            useImage: false,
            imagePath: '',
            imageDataUrl: null,
            imageOpacity: 0.2,
            imageFit: 'cover'
          }
        },
        style: {
          fontFamily: SERIF,
          baseFontIn: 0.16,
          sectionScale: 1,
          headingColor: '#111111',
          bodyColor: '#111111',
          accentColor: '#8a8a8a',
          blockBg: '#ffffff',
          blockOpacity: 1,
          blockBorderColor: '#e6e6e6',
          blockRadiusIn: 0,
          blockPaddingIn: 0,
          headerBg: '#ffffff',
          headerTextColor: '#8a8a8a',
          titleColor: '#111111',
          showBlockBorders: false,
          sectionHeaderIn: 0.5,
          sectionHeaderBg: '#ffffff',
          sectionHeaderColor: '#8a8a8a'
        },
        header: {
          heightIn: 1.4,
          logoLeft: { widthIn: 0 },
          logoRight: { widthIn: 0 },
          title: '',
          authors: '',
          affiliations: 'N O   R U S H',
          titleScale: 1,
          authorsScale: 1,
          affiliationsScale: 1,
          align: 'center'
        },
        columns: [
          createColumn('Sheet', null, createSplit('rows', [
            createLeaf({
              label: '',
              ratio: 3,
              markdown: '# The quietest room\nis the one you\nstopped decorating.',
              style: { align: 'left', showBorder: false }
            }),
            createLeaf({
              label: '',
              ratio: 0.6,
              markdown: '*— unattributed, and better for it*',
              style: { align: 'left', textColor: '#8a8a8a', showBorder: false }
            })
          ], 0.5))
        ]
      };
    }
  },

  {
    id: 'webinar-online',
    label: 'Webinar & Online',
    useCase: 'Social promotion, digital ads',
    size: 'Square 1:1 · 500 × 500 mm',
    blurb: 'Square digital card with badge overlays, avatar frames and a purple-teal gradient palette.',
    swatch: ['#6d28d9', '#14b8a6', '#f5f3ff'],
    build() {
      return {
        canvas: {
          widthIn: mm(500),
          heightIn: mm(500),
          margins: { top: 0.7, right: 0.7, bottom: 0.7, left: 0.7 },
          columnGapIn: 0.45,
          rowGapIn: 0.45,
          background: {
            color: '#f5f3ff',
            useImage: false,
            imagePath: '',
            imageDataUrl: null,
            imageOpacity: 0.2,
            imageFit: 'cover'
          }
        },
        style: {
          fontFamily: SANS,
          baseFontIn: 0.2,
          headingColor: '#4c1d95',
          bodyColor: '#1f2937',
          accentColor: '#14b8a6',
          blockBg: '#ffffff',
          blockOpacity: 1,
          blockBorderColor: '#ddd6fe',
          blockRadiusIn: 0.35,
          blockPaddingIn: 0.35,
          headerBg: '#6d28d9',
          headerTextColor: '#ede9fe',
          titleColor: '#ffffff',
          showBlockBorders: true,
          sectionHeaderIn: 0.7,
          sectionHeaderBg: '#14b8a6',
          sectionHeaderColor: '#04302b'
        },
        header: {
          heightIn: 5.2,
          logoLeft: { widthIn: 0 },
          logoRight: { widthIn: 2 },
          title: 'Shipping Design Systems That Survive Contact With Engineering',
          authors: 'Live webinar · Wednesday 12 June · 16:00 BST',
          affiliations: 'Free · 45 minutes · Recording sent to everyone who registers',
          titleScale: 1,
          authorsScale: 1.05,
          affiliationsScale: 0.95,
          align: 'left'
        },
        columns: [
          createColumn('Speakers', null, createSplit('rows', [
            createSectionLeaf('YOUR SPEAKERS'),
            createSplit('cols', [
              createImageLeaf('', {
                label: '',
                ratio: 1,
                image: {
                  alt: 'Speaker portrait placeholder',
                  fit: 'cover',
                  caption: '**Rosa Lindqvist**\nHead of Design Systems'
                },
                style: { align: 'center', radiusIn: 1.2 }
              }),
              createImageLeaf('', {
                label: '',
                ratio: 1,
                image: {
                  alt: 'Speaker portrait placeholder',
                  fit: 'cover',
                  caption: '**Tobi Aluko**\nStaff Front-End Engineer'
                },
                style: { align: 'center', radiusIn: 1.2 }
              })
            ], 0.4),
            createLeaf({
              label: '',
              ratio: 0.9,
              markdown: [
                '`LIVE` `Q&A` `TEMPLATES INCLUDED`',
                '',
                'What we will cover: versioning without breaking consumers, the review',
                'ritual that keeps tokens honest, and how to retire a component nobody',
                'admits to using.'
              ].join('\n')
            }),
            createLeaf({
              label: '',
              ratio: 0.55,
              markdown: '### Save your seat\n**example.com/webinar**',
              style: { align: 'center', bg: '#14b8a6', textColor: '#04302b', showBorder: false }
            })
          ], 0.4))
        ]
      };
    }
  }
];

/* ------------------------------------------------------------------ *
 * Application
 * ------------------------------------------------------------------ */

/**
 * Look a template up by id.
 * @param {string} id
 * @returns {object|null}
 */
export function findTemplate(id) {
  if (!id) return null;
  return POSTER_TEMPLATES.find((t) => t.id === id) || null;
}

/**
 * Build a complete poster document from a template.
 *
 * The template's branches are merged OVER `defaultPoster()` rather than replacing
 * it, so a template never has to restate the parts of the schema it does not care
 * about — and a field added to the schema later is automatically present in every
 * template without editing this file.
 *
 * @param {object} template an entry from POSTER_TEMPLATES
 * @param {{name?: string}} [opts]
 * @returns {object|null} a full poster state, or null when the template is unusable
 */
export function buildTemplateState(template, opts = {}) {
  if (!template || typeof template.build !== 'function') return null;

  const base = defaultPoster();
  const patch = template.build();
  const now = new Date().toISOString();

  const canvas = {
    ...base.canvas,
    ...(patch.canvas || {}),
    margins: { ...base.canvas.margins, ...((patch.canvas || {}).margins || {}) },
    background: { ...base.canvas.background, ...((patch.canvas || {}).background || {}) }
  };

  const header = {
    ...base.header,
    ...(patch.header || {}),
    // Logos are objects with an image descriptor; a template usually only wants
    // to change the reserved width, so the descriptor is preserved unless stated.
    logoLeft: { ...base.header.logoLeft, ...((patch.header || {}).logoLeft || {}) },
    logoRight: { ...base.header.logoRight, ...((patch.header || {}).logoRight || {}) }
  };

  return {
    meta: {
      name: opts.name || `${template.label.replace(/\s+/g, '_')}_Poster`,
      version: base.meta.version,
      created: now,
      modified: now,
      forkedFrom: null,
      templateId: template.id
    },
    canvas,
    style: { ...defaultStyle(), ...(patch.style || {}) },
    header,
    columns: Array.isArray(patch.columns) && patch.columns.length
      ? patch.columns
      : base.columns
  };
}
