/**
 * tutorialModal.js — Interactive in-app tutorial and comprehensive user guide.
 *
 * Provides a tabbed, accessible guide for first-time users and seasoned presenters
 * covering canvas dimensions, grid/block layouts, Markdown & LaTeX maths, image
 * figures, styling palettes, and print-ready PDF export.
 */

export function mountTutorialModal(triggerButton) {
  if (!triggerButton) return;

  let modalEl = null;

  function createModal() {
    const dialog = document.createElement('div');
    dialog.className = 'tutorial-overlay';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-label', 'Interactive Poster Studio Tutorial');

    dialog.innerHTML = `
      <div class="tutorial-card">
        <div class="tutorial-header">
          <div class="tutorial-title-group">
            <span class="tutorial-badge">Guide</span>
            <h2 class="tutorial-title">Interactive Poster Studio Tutorial</h2>
          </div>
          <button class="tutorial-close-btn" type="button" aria-label="Close tutorial">✕</button>
        </div>

        <nav class="tutorial-tabs" role="tablist">
          <button class="tutorial-tab active" data-tab="quickstart" role="tab" aria-selected="true">⚡ Quick Start</button>
          <button class="tutorial-tab" data-tab="layout" role="tab" aria-selected="false">📐 Layout & Grids</button>
          <button class="tutorial-tab" data-tab="markdown" role="tab" aria-selected="false">✍️ Text & LaTeX</button>
          <button class="tutorial-tab" data-tab="images" role="tab" aria-selected="false">🖼️ Figures</button>
          <button class="tutorial-tab" data-tab="styling" role="tab" aria-selected="false">🎨 Themes & Style</button>
          <button class="tutorial-tab" data-tab="export" role="tab" aria-selected="false">🖨️ PDF & Export</button>
        </nav>

        <div class="tutorial-body">
          <!-- Quick Start -->
          <div class="tutorial-pane active" id="pane-quickstart">
            <h3>Welcome to Interactive Poster Studio!</h3>
            <p>This designer runs 100% inside your browser with <strong>zero build steps</strong>, <strong>no backend</strong>, and <strong>complete privacy</strong> (nothing leaves your laptop).</p>
            
            <div class="tutorial-steps">
              <div class="tutorial-step">
                <div class="step-num">1</div>
                <div class="step-content">
                  <strong>Choose a Template or Set Board Size</strong>
                  <p>Click <span class="kbd">▤ Templates</span> in the left action rail to start with a standard 3-column, 4-column, or landscape layout, or adjust width/height in <em>Canvas & Page</em> (default: 48 × 36 inches).</p>
                </div>
              </div>

              <div class="tutorial-step">
                <div class="step-num">2</div>
                <div class="step-content">
                  <strong>Fill in Title & Authors</strong>
                  <p>In the <em>Header</em> section of the left panel (or by clicking the title directly on the poster), add your paper title, authors, affiliations, and upload institution logos.</p>
                </div>
              </div>

              <div class="tutorial-step">
                <div class="step-num">3</div>
                <div class="step-content">
                  <strong>Edit Content in Blocks</strong>
                  <p>Click any block on the poster to select it. Type your sections in Markdown with LaTeX equations, or switch a block to an Image block to showcase data figures.</p>
                </div>
              </div>

              <div class="tutorial-step">
                <div class="step-num">4</div>
                <div class="step-content">
                  <strong>Export Print-Ready PDF</strong>
                  <p>Click <span class="kbd">PDF</span> for a 300 DPI raster PDF, or <span class="kbd">⎙ Print</span> for a vector PDF ready for high-resolution professional plotting.</p>
                </div>
              </div>
            </div>
          </div>

          <!-- Layout & Grids -->
          <div class="tutorial-pane" id="pane-layout" hidden>
            <h3>Flexible Column & Block Hierarchy</h3>
            <p>Every poster consists of columns (1 to 6). Inside each column, you can recursively split blocks:</p>
            <ul>
              <li><strong>Horizontal / Row Split (⬍):</strong> Splits a block into stacked rows.</li>
              <li><strong>Vertical / Column Split (⬌):</strong> Splits a block into side-by-side sub-columns.</li>
              <li><strong>Proportion & Gap:</strong> Each child block has a proportional ratio (e.g., 1:2) or exact inch dimension, with customizable padding and gutters.</li>
              <li><strong>Document Tree:</strong> View and rearrange your nested structure seamlessly under the <em>Document Tree</em> section in the left panel.</li>
            </ul>
            <div class="tip-box">
              💡 <strong>Pro-tip:</strong> Use 3 columns for 48×36" posters with Introduction/Methods in Col 1, Results/Figures in Col 2, and Discussion/Conclusions in Col 3.
            </div>
          </div>

          <!-- Text & LaTeX -->
          <div class="tutorial-pane" id="pane-markdown" hidden>
            <h3>Formatting with Markdown & LaTeX Maths</h3>
            <p>All text blocks accept standard GitHub Flavored Markdown and full KaTeX mathematical expressions:</p>
            
            <div class="code-sample-grid">
              <div class="code-col">
                <strong>Markdown Syntax</strong>
                <pre><code># Section Title (H1)
## Subsection (H2)
**Bold text** and *italic*
- Bullet item 1
- Bullet item 2

Inline math: $W_2(\\mu, \\nu)$
Display math:
$$\\min_{T} \\int |x - T(x)|^2 d\\mu(x)$$</code></pre>
              </div>
              <div class="code-col">
                <strong>What Renders</strong>
                <div class="preview-box">
                  <h4 style="margin:0 0 4px 0; color:var(--text, #111);">Section Title</h4>
                  <p style="margin:0 0 6px 0; font-size:13px;"><strong>Bold text</strong> and <em>italic</em></p>
                  <ul style="margin:0 0 6px 0; padding-left:18px; font-size:13px;">
                    <li>Bullet item 1</li>
                    <li>Bullet item 2</li>
                  </ul>
                  <p style="margin:0; font-size:13px;">Optimal transport formulation with crisp mathematical typography.</p>
                </div>
              </div>
            </div>
          </div>

          <!-- Figures -->
          <div class="tutorial-pane" id="pane-images" hidden>
            <h3>Adding Figures, Plots & Images</h3>
            <p>Each block can instantly toggle between a <strong>Text Block</strong> and an <strong>Image Block</strong>:</p>
            <ul>
              <li><strong>File Upload:</strong> Click "Upload image" to select a file from your computer (PNG, JPG, SVG, WebP). The image is embedded as base64 in your saved design.</li>
              <li><strong>Local File Path:</strong> You can also type a relative path (e.g. <code>assets/figure1.png</code>) to reference images in the project directory.</li>
              <li><strong>Fit Modes:</strong> Choose <code>contain</code> (preserves aspect ratio without cropping) or <code>cover</code> (fills entire block container).</li>
              <li><strong>Captions:</strong> Add an optional caption below your figure with citation numbers.</li>
            </ul>
          </div>

          <!-- Themes & Style -->
          <div class="tutorial-pane" id="pane-styling" hidden>
            <h3>Styling, Palettes & Typography</h3>
            <p>Customize the visual personality of your poster:</p>
            <ul>
              <li><strong>Global Styles:</strong> Choose font pairing (e.g. Modern Sans, Editorial Serif, Technical Mono), base text size, heading scale, card background color, border radius, and accent color.</li>
              <li><strong>Per-Block Overrides:</strong> Select any specific block to override its background color, border, or text color (great for highlighting KEY FINDINGS in an accent box!).</li>
              <li><strong>Theme Switcher:</strong> Use the top bar theme selector to toggle between light/dark interface modes while working in low-light environments.</li>
            </ul>
          </div>

          <!-- Export & PDF -->
          <div class="tutorial-pane" id="pane-export" hidden>
            <h3>Printing & Offline Presentation</h3>
            <p>When your poster is ready for the conference or lab meeting:</p>
            <div class="export-options">
              <div class="export-card">
                <h4>📄 High-Resolution Raster PDF</h4>
                <p>Click <span class="kbd">PDF</span> in the action rail. Choose 150 DPI (for email/preview) or 300 DPI (for crisp commercial wide-format printing). Renders using html2canvas + jsPDF.</p>
              </div>
              <div class="export-card">
                <h4>🖨️ Vector Print PDF</h4>
                <p>Click <span class="kbd">⎙ Print</span> or press <span class="kbd">Ctrl/Cmd + P</span>. Use your browser's Print dialog to save as PDF with 100% scalable vector fonts and graphics.</p>
              </div>
              <div class="export-card">
                <h4>💾 JSON Design File</h4>
                <p>Click <span class="kbd">JSON</span> to download your entire poster layout. You can re-import this file on any computer to continue editing anytime.</p>
              </div>
            </div>
          </div>
        </div>

        <div class="tutorial-footer">
          <button class="btn btn--primary tutorial-done-btn" type="button">Got it, let's design! →</button>
        </div>
      </div>
    `;

    // Tabs switching
    const tabs = dialog.querySelectorAll('.tutorial-tab');
    const panes = dialog.querySelectorAll('.tutorial-pane');

    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        tabs.forEach(t => {
          t.classList.remove('active');
          t.setAttribute('aria-selected', 'false');
        });
        panes.forEach(p => {
          p.classList.remove('active');
          p.hidden = true;
        });

        tab.classList.add('active');
        tab.setAttribute('aria-selected', 'true');
        const targetPane = dialog.querySelector('#pane-' + tab.dataset.tab);
        if (targetPane) {
          targetPane.classList.add('active');
          targetPane.hidden = false;
        }
      });
    });

    // Close handlers
    const closeBtn = dialog.querySelector('.tutorial-close-btn');
    const doneBtn = dialog.querySelector('.tutorial-done-btn');

    const closeModal = () => {
      dialog.classList.remove('open');
      window.setTimeout(() => {
        if (dialog.parentNode) dialog.parentNode.removeChild(dialog);
      }, 200);
      document.removeEventListener('keydown', onKeyDown);
    };

    const onKeyDown = (e) => {
      if (e.key === 'Escape') closeModal();
    };

    closeBtn.addEventListener('click', closeModal);
    doneBtn.addEventListener('click', closeModal);
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) closeModal();
    });

    document.addEventListener('keydown', onKeyDown);

    document.body.appendChild(dialog);
    window.requestAnimationFrame(() => dialog.classList.add('open'));
    modalEl = dialog;
  }

  triggerButton.addEventListener('click', () => {
    createModal();
  });
}
