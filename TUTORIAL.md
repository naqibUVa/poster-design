# Interactive Poster Studio — Tutorial & Quick-Start Guide

An interactive, zero-build, entirely client-side designer for **large-format academic and conference posters** (e.g. 48" × 36", 36" × 24", A0).

---

## 🚀 How to Clone and Run on Any Laptop

This application uses native ES modules and runs 100% locally in your web browser. Nothing is sent to any server.

### 🍏 macOS
1. Double-click `start.command` in the project folder.
2. If macOS displays a permissions notice, make it executable once in Terminal:
   ```bash
   chmod +x start.command
   ```
3. Your browser will automatically open to `http://localhost:5173`.

### 🪟 Windows
1. Double-click `start.bat`.
2. The local server starts and opens your default browser.

### 🐧 Linux / Any Terminal (Zero Dependencies)
You can run it using any static server tool already installed on your machine:
```bash
# Using Python (installed on almost all Macs and Linux machines)
python3 -m http.server 5173

# Or using Node.js
npx serve -l 5173 .
```
Then visit `http://localhost:5173`.

---

## 📖 Step-by-Step Poster Creation Guide

### 1. Canvas Dimensions & Margin Setup
- In the left panel, open **Canvas & Page**.
- Set your poster width and height in inches (default: 48 in × 36 in).
- Set page margins (default: 0.5 in).
- Use the Zoom controls in the top bar (`+`, `-`, or **Fit**) to frame the entire board on your screen.

### 2. Header, Authors & Logos
- Open **Header** in the left panel.
- Enter your paper title, authors, affiliations, and presentation venue.
- Upload institution or lab logos to the left and right logo slots.

### 3. Creating Multi-Column & Block Layouts
- Open **Columns**: choose between 1 and 6 vertical columns.
- Inside any block, click:
  - **Row Split (⬍)** to split into stacked rows.
  - **Column Split (⬌)** to split into sub-columns.
- Adjust child block ratios (e.g. `1` and `2` for a 1:2 split) or specify exact dimensions in inches.

### 4. Writing Content with Markdown & LaTeX Maths
- Click any block to select it.
- Use standard Markdown formatting:
  - Headers: `# Heading 1`, `## Heading 2`
  - Lists: `- Item 1`, `1. Item 1`
  - Bold & Italic: `**bold**`, `*italic*`
- Add mathematical expressions powered by KaTeX:
  - Inline math: `$W_2(\mu, \nu)$`
  - Display equations:
    ```latex
    $$\min_{T} \int |x - T(x)|^2 d\mu(x)$$
    ```

### 5. Adding Data Figures & Plots
- In the block controls, switch the block type from **Text** to **Image**.
- Click **Upload image** to insert a PNG, JPG, or SVG from your laptop.
- Choose between `contain` (aspect ratio preserved) and `cover` (fills container).
- Add an optional descriptive caption below the figure.

### 6. Exporting Print-Ready PDFs
- **High-Resolution Raster PDF**: Click `PDF` in the left action rail. Choose 150 DPI or 300 DPI for conference plotters.
- **Vector PDF / Print**: Click `⎙ Print` or press `Ctrl/Cmd + P` and choose **Save as PDF** for vector sharpness.
- **Save Project**: Click `JSON` to export your poster file so you can re-load and edit it on any computer.

---

## 📤 Uploading to GitHub

To push this project to your GitHub:
```bash
git init
git add .
git commit -m "feat: initial commit for Interactive Poster Studio with interactive tutorial"
git branch -M main
git remote add origin https://github.com/naqibUVa/poster-studio.git
git push -u origin main
```
