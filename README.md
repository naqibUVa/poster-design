# Interactive Poster Studio

[![Live App](https://img.shields.io/badge/Live%20Web%20App-Design%20Posters%20Online-emerald?style=for-the-badge&logo=githubpages)](https://naqibuva.github.io/poster-design/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> 🚀 **Live Online Version**: Design posters, follow the interactive tutorial, and export PDFs directly in your browser:  
> 👉 **[https://naqibuva.github.io/poster-design/](https://naqibuva.github.io/poster-design/)**

A zero-install, entirely client-side designer for **large-format academic and conference
posters**. Lay out a 48 × 36 inch poster in columns and recursively nested blocks, write your
content in Markdown with LaTeX maths, drop in figures by upload *or* by file path, and export
a print-ready PDF — all in the browser, with nothing sent anywhere.

There is no build step, no framework, and no backend. Use it online or run locally.


---

## Table of contents

- [Feature tour](#feature-tour)
- [Quick start](#quick-start)
- [Why it needs a local server](#why-it-needs-a-local-server)
- [Folder structure](#folder-structure)
- [Working with images and file paths](#working-with-images-and-file-paths)
- [Autosave, forking and file formats](#autosave-forking-and-file-formats)
- [Exporting for print](#exporting-for-print)
- [Markdown and LaTeX](#markdown-and-latex)
- [Keyboard shortcuts](#keyboard-shortcuts)
- [Pushing to GitLab](#pushing-to-gitlab)
- [Offline use](#offline-use)
- [Troubleshooting](#troubleshooting)
- [Extending the app](#extending-the-app)

---

## Feature tour

**Canvas and page setup**
- Poster size in inches (defaults to 48 in wide × 36 in high — the standard US conference board).
- Four independent margins (default 0.5 in each).
- Solid background colour, or a background image with a 0–100 % opacity slider and
  cover / contain / tile fitting.
- Zoom with a slider, `+` / `−`, or **Fit** to frame the whole board.

**Header band**
- A fixed 4 in top band with a 2 in logo box at each end and a flexible centre.
- Editable paper title, author list and multi-line affiliations — click straight on the poster
  to type, or edit them in the left panel.

**Columns and recursive blocks**
- Choose 1–6 columns. Give any column an exact width in inches; leave the rest blank and they
  share the remaining space automatically.
- Split any block into **rows** (⬍) or **columns** (⬌), as deeply as you like. Each child has a
  ratio, an optional exact size in inches, and a configurable gap.
- Every leaf block is either a **Markdown text block** (with LaTeX) or an **image block**, and
  you can flip between the two at any time.

**Styling**
- Global controls for font family, font scale, base text size, heading / body / accent colours,
  block background, border and radius, block opacity, and the header band's colours.
- Per-block overrides for all of the above, each with a ↺ button that hands control back to the
  global setting.
- Theme presets for a fast restyle.

**Left panel**
- Collapsible, with eight sections: Project, Canvas & Page, Header, Columns, Document Tree,
  Global Styles, Selected Block and a Markdown/LaTeX cheatsheet.
- The **document tree** maps the whole poster live: title, authors, affiliations, both logos and
  every nested block. Click any entry to scroll to that element and flash it on the canvas.

**Files**
- Continuous autosave to `localStorage`.
- Import a `.json` design — it is **forked** into a working copy so the original is never
  overwritten.
- One-click export to `.json` (complete layout state), `.md` (content archive) and `.pdf`.

---

## Quick start

Pick whichever route suits you. All three do the same thing: serve this folder and open it.

### 1. Double-click launcher (easiest)

| Platform | File | First-time note |
|---|---|---|
| macOS / Linux | `start.command` | If it does not launch, run `chmod +x start.command` once. |
| Windows | `start.bat` | Just double-click it. |

Each script finds a free port starting at `5173`, picks whichever server you already have
(`python3`, then `python`, then `npx serve`), and opens your browser.

### 2. npm

```bash
npm start            # npx serve on http://localhost:5173
```

No dependencies are installed by the project itself — `serve` is fetched on demand by `npx`.

### 3. Python (no Node required)

```bash
python3 -m http.server 5173
# then open http://127.0.0.1:5173/index.html
```

Other one-liners that work equally well: `php -S 127.0.0.1:5173`, `ruby -run -e httpd . -p 5173`,
or the "Live Server" extension in VS Code.

---

## Why it needs a local server

`index.html` loads `js/app.js` as a native ES module (`<script type="module">`). Browsers apply
CORS rules to module imports, and the `file://` scheme has no origin — so opening `index.html`
by double-clicking it produces a blank page and a console error like *"Cross origin requests are
only supported for protocol schemes: http, https…"*.

Serving the folder over `http://127.0.0.1` fixes it. That is the only reason the launchers exist;
nothing is uploaded, and the app works with your network cable unplugged.

---

## Folder structure

```
poster-studio/
├── index.html               App shell: topbar, left panel mount, canvas stage
├── README.md                This file
├── .gitignore               Pre-configured for GitLab / GitHub
├── package.json             npm scripts for a lightweight dev server
├── start.command            Double-click launcher (macOS / Linux)
├── start.bat                Double-click launcher (Windows)
├── assets/
│   └── placeholders/        Default logos, textures and sample figures
│       ├── logo-left.svg          Header logo slot 1
│       ├── logo-right.svg         Header logo slot 2
│       ├── no-image.svg           Neutral stand-in artwork
│       ├── texture-grid.svg       Tileable background texture
│       ├── sample-chart.svg       Example results figure
│       └── sample-photo.svg       Example image-panel figure
├── css/
│   ├── layout.css           Canvas, panel, grid and block layout + print rules
│   ├── controls.css         Sidebar tools, inputs, buttons, tree, toasts
│   └── typography.css       Font stacks, Markdown prose styles, KaTeX tuning
└── js/
    ├── data.js              Default poster template + factory helpers
    ├── posterState.js       Reactive store, undo/redo, nested-tree operations
    ├── storage.js           Autosave, import/export, image resolver, toasts
    ├── pdfExporter.js       High-resolution PDF + vector print routes
    ├── components/
    │   ├── leftPanel.js     Trackers, document tree, style and block controls
    │   └── canvas.js        Interactive canvas: header, columns, nested blocks
    └── app.js               Initialisation, top bar, shortcuts, drag & drop
```

Each module owns one concern and can be edited without touching the others. `js/data.js` is the
first place to look if you want a different starting template; `css/` is safe to restyle wholesale.

---

## Working with images and file paths

Every image slot in the app — both header logos, the canvas background, and any image block —
accepts **two kinds of input**, and you can mix them freely in one poster.

**1. Browse / upload.** Pick a file from disk. It is read as a base64 data URL and stored inside
the design, so the poster renders even if the original file moves. The filename is also recorded
as `./assets/<filename>` so the reference stays meaningful.

**2. Type or paste a path.** Anything the browser can load works:

| Kind | Example |
|---|---|
| Relative to `index.html` | `./assets/my_chart.png` |
| Relative, parent folder | `../figures/fig3.jpg` |
| Absolute (macOS/Linux) | `/Users/you/figures/fig3.png` |
| Absolute (Windows) | `C:/Images/logo.png` |
| Remote URL | `https://example.org/logo.svg` |

> Relative paths resolve against the location of `index.html`. The most portable habit is to copy
> your figures into `assets/` and reference them as `./assets/<name>`, so the whole folder can be
> zipped or pushed to GitLab and still render on someone else's machine.
>
> Absolute local paths (`/Users/...`, `C:/...`) are recorded faithfully in your exports, but
> browsers will not load them from an `http://` page — they only render if the same file exists
> when you re-open the design somewhere that can reach it. Use uploads or `./assets/` when you
> need the poster to travel.

**Missing images never break the layout.** If a path is wrong, the file has moved, or a URL fails,
the block renders a neutral *"No Image Available"* placeholder showing the path it tried, at
exactly the size the image would have occupied. Fix the path and it appears immediately.

**Paths always survive export.** Both `.json` and `.md` record the path string for every image —
including uploaded ones, and including images referenced from inside Markdown. The Markdown export
ends with an **Image Manifest** table listing every path the poster depends on, so you know exactly
which files to copy alongside it.

---

## Autosave, forking and file formats

- **Autosave.** Every edit is written to `localStorage` (debounced), and the top bar shows
  *"All changes saved · HH:MM:SS"*. Closing the tab and coming back restores your session.
- **Load and fork.** Importing a `.json` design does *not* take over that file. The app creates a
  working copy — `My_Poster` becomes `My_Poster_Copy` — and autosaves that from then on, so your
  source file on disk is never silently modified. Export when you want to write it back.
- **`.json`** is the complete state dump: canvas geometry, margins, every style value, the full
  block tree, and every image path (with uploaded image data embedded, unless you untick
  *"embed images"*). This is the format to re-import.
- **`.md`** is a readable content archive: YAML front matter with the page setup, then the title,
  authors, affiliations and every block's Markdown in document order, with image references and
  the manifest. Good for version control diffs, co-author review, and pasting into a paper.
- **`.pdf`** is the print deliverable — see below.

To start over, use **Reset to template** in the Project section (it asks first).

---

## Exporting for print

Two routes, because they fail in different ways:

**Export PDF (raster).** Renders the poster to a canvas at your chosen DPI and wraps it in a PDF
whose page size is exactly your poster's dimensions in inches. Choose 96 / 150 / 300 DPI in the
Project section.

> A 48 × 36 in poster at 300 DPI is 14 400 × 10 800 px — about 155 megapixels, which exceeds what
> browsers will allocate. The exporter detects this, lowers the DPI to fit within a safe budget,
> and tells you what it used. **150 DPI is the sweet spot** for a poster viewed from a metre away.

**Print / Save as vector PDF.** Uses the browser's own print pipeline with an `@page` rule carrying
the true poster size, then *Destination → Save as PDF*. Text and vector figures stay **crisp at any
zoom** and the file is far smaller. This is usually the better choice for a print shop; use the
raster route when you need a guaranteed pixel-identical rendering.

Either way, set your print shop's paper size to match the poster's inch dimensions and print at
100 % scale (no "fit to page").

---

## Markdown and LaTeX

Text blocks are Markdown: headings, **bold**, *italic*, bullet and numbered lists, tables,
blockquotes, `inline code`, fenced code, links and images.

Maths is rendered with KaTeX:

- Inline: `$E = mc^2$`
- Display: `$$\int_0^1 x^2\,dx = \tfrac{1}{3}$$`

Every new text block starts pre-populated with a Markdown placeholder demonstrating headings,
bullets, bolding and inline LaTeX, so there is always a working example to edit rather than a
blank box. The **Markdown & LaTeX Guide** section at the bottom of the left panel is a copyable
cheatsheet.

Double-click any text block on the canvas to edit it in place; press **Esc** or click away to commit.

---

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl` / `Cmd` + `S` | Export the design as `.json` |
| `Ctrl` / `Cmd` + `P` | Print / save as vector PDF |
| `Ctrl` / `Cmd` + `Z` | Undo |
| `Ctrl` / `Cmd` + `Shift` + `Z` | Redo |
| `Ctrl` / `Cmd` + `Y` | Redo (Windows convention) |
| `Ctrl` / `Cmd` + `+` / `-` | Zoom in / out |
| `Ctrl` / `Cmd` + `0` | Zoom to fit the whole sheet |
| `Delete` / `Backspace` | Delete the selected block |
| `Esc` | Commit an inline edit, then clear the selection |

Shortcuts without a modifier are ignored while you are typing in a field, and
undo/redo is handed back to the browser inside a text field so it rewinds your
typing rather than the whole poster.

You can also **drag and drop**: a `.json` file dropped anywhere imports it (forked), and an image
file dropped onto a block puts that image in the block.

---

## Pushing to GitLab

The repository is clean out of the box — `.gitignore` already covers `node_modules/`, `.DS_Store`,
editor folders, caches, logs and temporary poster exports.

```bash
cd poster-studio

git init
git add .
git commit -m "Add Interactive Poster Studio"

# Create an empty project in GitLab first, then:
git remote add origin git@gitlab.com:<your-group>/<your-project>.git
git branch -M main
git push -u origin main
```

Using HTTPS instead of SSH:

```bash
git remote add origin https://gitlab.com/<your-group>/<your-project>.git
git push -u origin main
```

**Publishing it as a live site.** Because the app is fully static, GitLab Pages can host it with a
three-line `.gitlab-ci.yml`:

```yaml
pages:
  stage: deploy
  script:
    - mkdir -p public && cp -r index.html css js assets public/
  artifacts:
    paths: [public]
  only: [main]
```

Colleagues can then design posters at `https://<your-group>.gitlab.io/<your-project>/` with no
install at all.

**Sharing a specific poster.** Exports are git-ignored by design. Commit one deliberately with
`git add -f my_poster.json`, and keep its figures in `assets/` so the paths resolve for everyone.

---

## Offline use

Four libraries load from a CDN: **marked** (Markdown), **KaTeX** (maths), **html2canvas** and
**jsPDF** (raster PDF). Every one of them is optional — the app checks before use and degrades:

| Missing | What happens |
|---|---|
| marked | A built-in Markdown renderer takes over (headings, lists, tables, emphasis, code, links, images). |
| KaTeX | Equations render as plain `$…$` source in a monospace style instead of typeset maths. |
| html2canvas / jsPDF | *Export PDF* explains the situation and points you at the Print route, which needs no libraries. |

So the studio still starts, edits, autosaves, exports `.json`/`.md` and prints with no network at
all. To make maths and full Markdown work permanently offline, download the four files into
`assets/vendor/` and repoint the `<script>` and `<link>` tags at the top of `index.html`.

---

## Troubleshooting

**Blank page, console says something about modules or CORS.**
You opened `index.html` directly from the filesystem. Use a launcher or `npm start` —
see [Why it needs a local server](#why-it-needs-a-local-server).

**`start.command` does nothing when double-clicked (macOS).**
The executable bit was lost in transit. Run `chmod +x start.command` once in Terminal. If macOS
blocks it as unidentified, right-click → **Open** and confirm.

**Port 5173 is already in use.**
`start.command` walks forward to the next free port automatically and prints the URL it chose.
On Windows, edit `set "PORT=5173"` near the top of `start.bat`.

**A figure shows "No Image Available".**
The path did not resolve. Check it in the Selected Block panel: relative paths are relative to
`index.html`, and `http://` pages cannot load `file:///` or bare `C:/…` paths. Copy the file into
`assets/` and use `./assets/<name>`, or use **Browse** to embed it.

**PDF export is slow, huge, or fails.**
That is the megapixel budget. Drop to 150 DPI, or use **Print → Save as PDF** for a smaller,
sharper, vector file.

**Equations show as raw `$…$`.**
KaTeX did not load — you are offline or a network policy blocked the CDN. Everything else still
works; see [Offline use](#offline-use).

**My work disappeared.**
State lives in `localStorage` for this browser and origin. A different browser, a different port,
or clearing site data all start fresh. Export a `.json` for anything you care about — it is the
only durable copy.

---

## Extending the app

- **Change the starting poster**: edit `defaultPoster()` in `js/data.js`.
- **Add a style control**: add the field to `defaultStyle()` in `js/data.js`, render it in the
  Global Styles section of `js/components/leftPanel.js`, and consume it in `buildPoster()` in
  `js/components/canvas.js`.
- **Add a block content type**: extend `setBlockType()` in `js/posterState.js`, add a branch to the
  leaf renderer in `js/components/canvas.js`, and add its controls to the inspector.
- **Restyle everything**: the three files in `css/` are independent — layout, controls and
  typography — so you can replace one without disturbing the others.

`buildPoster()` is deliberately the single rendering path for the on-screen canvas, the PDF
exporter and the print route. It takes a pixels-per-inch value, so zoom is just a smaller `ppi` —
which is why what you see on screen is exactly what prints.

---

Built as a static, dependency-free ES-module app. Everything stays on your machine.
