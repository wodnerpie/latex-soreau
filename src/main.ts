import { templates, examples } from './templates';
import type { EditorHandle } from './editor';
import { buildSvg, dimensions, download, imageBlob, type Appearance } from './export';
import type { RenderedEquation } from './render';
import './style.css';

const STORAGE_KEY = 'latex-soreau-v1';
const defaults: Appearance = { ink: '#000000', background: 'transparent', fontSize: 32, padding: 16, scale: 2 };
type Settings = Appearance & { display: boolean; theme: string; saveDraft: boolean; format: string; quality: number };
let settings: Settings = { ...defaults, display: true, theme: 'system', saveDraft: true, format: 'svg', quality: 95 };
let source = examples['Quadratic formula'];
let storageAvailable = true;
let shared = false;

function clamp(value: unknown, min: number, max: number, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}
function readSettings(value: unknown) {
  if (!value || typeof value !== 'object') return;
  const v = value as Record<string, unknown>;
  const color = (v: unknown, fallback: string) => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v : fallback;
  settings = {
    ink: color(v.ink, settings.ink),
    background: v.background === 'transparent' ? 'transparent' : color(v.background, settings.background),
    fontSize: clamp(v.fontSize, 8, 200, settings.fontSize),
    padding: clamp(v.padding, 0, 200, settings.padding),
    scale: clamp(v.scale, 1, 8, settings.scale),
    display: typeof v.display === 'boolean' ? v.display : settings.display,
    theme: ['light', 'dark', 'system'].includes(String(v.theme)) ? String(v.theme) : settings.theme,
    saveDraft: typeof v.saveDraft === 'boolean' ? v.saveDraft : settings.saveDraft,
    format: ['svg', 'png', 'jpg', 'webp', 'tex'].includes(String(v.format)) ? String(v.format) : settings.format,
    quality: clamp(v.quality, 10, 100, settings.quality),
  };
}
try {
  const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
  if (saved) {
    readSettings(saved.settings);
    if (settings.saveDraft && typeof saved.source === 'string') source = saved.source;
  }
} catch { storageAvailable = false; }
if (location.hash.startsWith('#equation=')) {
  try {
    const data = JSON.parse(decodeURIComponent(location.hash.slice(10)));
    if (typeof data.source === 'string' && data.source.length <= 20000) {
      source = data.source;
      // A shared equation does not alter the recipient's theme or privacy preferences.
      readSettings({ ...data.appearance, saveDraft: settings.saveDraft, theme: settings.theme });
      shared = true;
    }
  } catch { /* A broken link never prevents opening the editor. */ }
}

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <header>
    <h1>LaTeX equation editor</h1>
    <div class="header-controls">
      <details id="preferences" class="menu">
        <summary>Settings</summary>
        <div class="dropdown-panel preferences-panel">
          <label class="inline-label" for="theme">Theme <select id="theme"><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select></label>
          <label class="checkbox"><input id="save-draft" type="checkbox" checked /> Save draft in this browser</label>
          <span id="save-status" class="hint"></span>
        </div>
      </details>
    </div>
  </header>
  <main>
    <div class="workspace">
      <section class="source-panel" aria-labelledby="source-title">
        <div class="panel-heading">
          <h2 id="source-title">LaTeX</h2>
          <div class="actions">
          <details id="insert-tools" class="menu wide-menu">
          <summary>Insert</summary>
          <div class="dropdown-panel">
          <div class="template-filters">
            <label class="sr-only" for="category">Template category</label>
            <select id="category"><option>Structure</option><option>Calculus</option><option>Symbols</option><option>Greek</option><option>Sets</option><option>Layouts</option><option>All</option></select>
            <label class="sr-only" for="template-search">Search templates</label>
            <input id="template-search" type="search" placeholder="Search templates…" autocomplete="off" />
          </div>
          <div id="templates" class="template-list"></div>
        <div class="example-row">
          <label for="examples">Examples</label>
          <select id="examples"><option value="">Choose an example…</option></select>
          <button id="load-example" type="button" disabled>Load</button>
        </div>
          </div>
          </details>
          <details id="source-actions" class="menu">
            <summary>More</summary>
            <div class="dropdown-panel action-menu">
              <button id="copy-source" type="button">Copy LaTeX</button>
              <button id="share" type="button" title="Copy a link containing the current equation and appearance">Copy link</button>
              <button id="clear" type="button" title="Clear the editor (undo to restore)">Clear</button>
              <span id="char-count" class="hint"></span>
            </div>
          </details>
          </div>
        </div>
        <div id="editor" aria-busy="true"><p class="editor-loading">Loading editor…</p></div>
        <div class="editor-footer"><span>Type <kbd>\\</kbd> for commands. <kbd>Tab</kbd> accepts, <kbd>Ctrl</kbd>+<kbd>Space</kbd> lists them.</span></div>
      </section>
      <section class="preview-panel" aria-labelledby="preview-title">
        <div class="panel-heading"><h2 id="preview-title">Preview</h2></div>
        <div id="preview-stage" class="checker"><div id="preview"><span class="empty-preview">Rendering equation…</span></div></div>
        <div class="preview-status"><span id="render-status" role="status" aria-live="polite">Loading renderer…</span><button id="retry" type="button" hidden>Retry</button></div>
        <div id="render-error" role="status" aria-live="polite" hidden></div>
        <div class="download-actions">
          <label for="format" class="sr-only">Format</label><select id="format"><option value="svg">SVG (vector)</option><option value="png">PNG</option><option value="jpg">JPG</option><option value="webp">WebP</option><option value="tex">LaTeX (.tex)</option></select>
          <button id="download" class="primary" type="button" disabled>Download SVG</button>
          <button id="copy-image" type="button" title="Copy a PNG using the current appearance and image scale" disabled>Copy image</button>
        </div>
        <p id="export-note" class="hint" hidden>SVG stays sharp at any size.</p>
        <div class="preview-options">
        <details id="appearance-options" class="menu wide-menu"><summary>Appearance</summary>
        <div class="dropdown-panel">
        <div class="appearance">
          <div class="control"><label for="ink-preset">Equation color</label><div class="color-control"><select id="ink-preset"><option value="#000000">Black</option><option value="#ffffff">White</option><option value="custom">Custom</option></select><input type="color" id="ink" aria-label="Custom equation color" value="#000000" /></div></div>
          <div class="control"><label for="background-preset">Background</label><div class="color-control"><select id="background-preset"><option value="transparent">Transparent</option><option value="#ffffff">White</option><option value="#000000">Black</option><option value="custom">Custom</option></select><input type="color" id="background" aria-label="Custom background color" value="#ffffff" /></div></div>
          <div class="control"><label for="font-size">Font size (px)</label><input id="font-size" type="number" min="8" max="200" value="32" /></div>
          <div class="control"><label for="padding">Padding (px)</label><input id="padding" type="number" min="0" max="200" value="16" /></div>
        </div>
        <label class="checkbox display-option"><input id="display" type="checkbox" checked /> Display style</label>
        </div>
        </details>
        <details id="export-options" class="menu wide-menu"><summary>Export options</summary>
        <div class="dropdown-panel">
          <div class="export-controls">
            <div class="control"><label for="scale">Image scale</label><select id="scale"><option value="1">1×</option><option value="2" selected>2×</option><option value="3">3×</option><option value="4">4×</option><option value="8">8×</option></select></div>
            <div class="control"><label for="filename">Filename</label><input id="filename" type="text" value="equation" maxlength="80" spellcheck="false" /></div>
          </div>
          <div id="quality-control" class="quality-control" hidden><label for="quality">Quality <output id="quality-value">95%</output></label><input id="quality" type="range" min="10" max="100" value="95" /></div>
          <div class="export-info hint"><span id="size-info"></span><span id="export-size"></span></div>
          <p class="hint">Image scale affects PNG, JPG, WebP, and Copy image. SVG stays sharp at any size.</p>
        </div>
        </details>
        </div>
      </section>
    </div>
    <details class="help"><summary>Help &amp; shortcuts</summary><div class="help-content">
      <p>Write math directly, without <code>$</code> delimiters. Pasted <code>$…$</code>, <code>$$…$$</code>, <code>\\(…\\)</code>, and <code>\\[…\\]</code> also work. This is an equation editor, not a full LaTeX document compiler.</p>
      <p>Use <code>\\\\</code> between equations for centered line breaks, or <code>\\begin{aligned}a &amp;= b \\\\ c &amp;= d\\end{aligned}</code> to align them. Plain newlines in the source are whitespace, as in LaTeX. Image exports keep the line breaks; LaTeX downloads and Copy LaTeX keep your original source. AMS math, matrices, cases, colors, and common physics commands are supported.</p>
      <p><kbd>Tab</kbd> accepts a suggestion, then moves through the snippet fields. <kbd>Ctrl</kbd>+<kbd>Space</kbd> lists commands anywhere, including after a partial word like <code>frac</code>. <kbd>Shift</kbd>+<kbd>Tab</kbd> goes back a snippet field, or outdents. <kbd>Esc</kbd> clears a selection, then leaves the editor. <kbd>Ctrl</kbd>+<kbd>Z</kbd> undoes edits, including loading an example or clearing. <kbd>Ctrl</kbd>+<kbd>Enter</kbd> renders immediately. <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>S</kbd> downloads. Use <kbd>⌘</kbd> instead of <kbd>Ctrl</kbd> on Mac.</p>
      <p>The editor is Monaco, the same editor as VS Code, with its default shortcuts: <kbd>Ctrl</kbd>+<kbd>A</kbd> selects everything, <kbd>Ctrl</kbd>+<kbd>D</kbd> adds the next matching selection, <kbd>Alt</kbd>+<kbd>↑</kbd>/<kbd>↓</kbd> moves a line, <kbd>Ctrl</kbd>+<kbd>F</kbd> finds, and dragging or double-clicking selects text.</p>
      <p>Incomplete equation? Missing closing braces, <code>\\right</code> delimiters, and <code>\\end{…}</code> tags are filled in automatically, so the preview follows along while you type. Other syntax errors keep the last valid preview, and a compact message explains what to fix. Image downloads and Copy image use the preview; LaTeX downloads and Copy LaTeX always use your current text.</p>
      <p>Transparent backgrounds use a checkerboard here; it is never included in downloads. JPG cannot be transparent and uses white instead. Image scale affects raster images, including Copy image; SVG is vector.</p>
      <p>Everything renders locally in your browser. No accounts, analytics, or equation uploads. Copy link includes the equation in the URL fragment; anyone with the link can read it. Links longer than 12,000 characters should be shared as a .tex file instead.</p>
    </div></details>
  </main>
  <footer><a href="https://github.com/wodnerpie/latex-soreau" target="_blank" rel="noopener noreferrer">GitHub</a></footer>
  <div id="notice" role="status" aria-live="polite"></div>
`;

function el<T extends HTMLElement = HTMLElement>(id: string): T { return document.getElementById(id) as T; }
const input = (id: string) => el<HTMLInputElement>(id);
const select = (id: string) => el<HTMLSelectElement>(id);
const button = (id: string) => el<HTMLButtonElement>(id);
const menus = [...document.querySelectorAll<HTMLDetailsElement>('details.menu')];
function closeMenu(id: string) { el<HTMLDetailsElement>(id).open = false; }
document.addEventListener('click', event => {
  if (!(event.target instanceof Node)) return;
  for (const menu of menus) {
    if (menu.open && !menu.contains(event.target)) menu.open = false;
  }
});
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  const menu = menus.find(menu => menu.open);
  if (menu) {
    menu.open = false;
    menu.querySelector('summary')?.focus();
    event.preventDefault();
  }
});
el('source-actions').addEventListener('click', event => {
  if (!(event.target instanceof HTMLButtonElement)) return;
  closeMenu('source-actions');
  if (event.target.id !== 'clear') el('source-actions').querySelector('summary')?.focus();
});
let noticeTimer: ReturnType<typeof setTimeout>;
function notice(message: string) {
  el('notice').textContent = message;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { el('notice').textContent = ''; }, 6000);
}

function prefersDark() {
  return settings.theme === 'dark' || (settings.theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
}
let editorModule: typeof import('./editor') | undefined;
function applyTheme() {
  document.documentElement.dataset.theme = settings.theme;
  editorModule?.setEditorTheme(prefersDark());
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (settings.theme === 'system') applyTheme(); });

let saveTimer: ReturnType<typeof setTimeout>;
let editor: EditorHandle | undefined;
/**
 * Monaco is about a megabyte, so it loads after the first paint instead of
 * blocking it. Anything that needs the editor awaits this promise.
 */
const editorReady = import('./editor').then(async module => {
  editorModule = module;
  const container = el('editor');
  // Wait for JetBrains Mono first: Monaco caches glyph metrics at creation, and
  // a font that swaps in later makes clicks land beside the text under the pointer.
  await module.loadEditorFont();
  container.replaceChildren();
  container.removeAttribute('aria-busy');
  editor = module.createEditor(container, {
    value: source,
    dark: prefersDark(),
    onInput(value) {
      source = value;
      updateCount();
      queueRender();
      clearTimeout(saveTimer);
      saveTimer = setTimeout(save, 400);
      // Once edited, the old share link no longer describes the current draft.
      if (location.hash) historyReplace();
    },
    onRenderRequest: () => queueRender(true),
    onDownloadRequest: () => void exportCurrent(),
  });
  return editor;
}).catch(error => {
  el('editor').innerHTML = '<p class="editor-loading">The editor could not load. Reload the page.</p>';
  throw error;
});

function historyReplace() { window.history.replaceState(null, '', location.pathname + location.search); }
function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ settings, ...(settings.saveDraft ? { source } : {}) }));
    el('save-status').textContent = settings.saveDraft ? 'Draft saved locally' : 'Draft saving off';
  } catch {
    storageAvailable = false;
    el('save-status').textContent = 'Browser storage unavailable';
  }
}
window.addEventListener('pagehide', save);
document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });
function updateCount() { el('char-count').textContent = `${source.length.toLocaleString()} characters`; }
function replaceSource(value: string) {
  void editorReady.then(instance => {
    instance.replaceAll(value);
    instance.focus();
  });
}

function insertTemplate(latex: string) {
  closeMenu('insert-tools');
  void editorReady.then(instance => instance.insertTemplate(latex));
}
function showTemplates() {
  const category = select('category').value;
  const query = input('template-search').value.trim().toLowerCase();
  const found = templates.filter(t => (query || category === 'All' || t.category === category) && (!query || `${t.label} ${t.latex} ${t.category}`.toLowerCase().includes(query)));
  const container = el('templates');
  container.replaceChildren();
  for (const template of found) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = template.label;
    b.title = template.latex;
    // Keep the source selection while pressing a quick-insert button.
    b.addEventListener('mousedown', event => event.preventDefault());
    b.addEventListener('click', () => insertTemplate(template.latex));
    container.append(b);
  }
  if (!found.length) container.textContent = 'No matching templates.';
}
select('category').addEventListener('change', showTemplates);
input('template-search').addEventListener('input', showTemplates);
for (const name of Object.keys(examples)) select('examples').add(new Option(name, name));
select('examples').addEventListener('change', () => { button('load-example').disabled = !select('examples').value; });
button('load-example').addEventListener('click', () => {
  if (examples[select('examples').value]) {
    closeMenu('insert-tools');
    replaceSource(examples[select('examples').value]);
  }
});
button('clear').addEventListener('click', () => replaceSource(''));

let worker: Worker | undefined;
let renderId = 0;
let renderTimer: ReturnType<typeof setTimeout>;
let timeout: ReturnType<typeof setTimeout>;
let lastGood: RenderedEquation | undefined;
let hasRendered = false;
let pending = true;

function ensureWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./render.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (event: MessageEvent<{ id: number; result?: RenderedEquation; error?: string }>) => {
    if (event.data.id !== renderId) return;
    clearTimeout(timeout);
    hasRendered = true;
    pending = false;
    if (event.data.result) {
      lastGood = event.data.result;
      el('render-error').hidden = true;
      el('render-status').textContent = lastGood.completed ? 'Incomplete equation (auto-closed for preview)' : 'Up to date';
      button('retry').hidden = true;
      updatePreview();
    } else showRenderError(event.data.error || 'Check the equation syntax.');
    updateExportControls();
  };
  worker.onerror = event => {
    event.preventDefault();
    clearTimeout(timeout);
    worker?.terminate();
    worker = undefined;
    pending = false;
    showRenderError('Renderer could not load. Retry, or reload the page.');
    button('retry').hidden = false;
    updateExportControls();
  };
  return worker;
}
function showRenderError(message: string) {
  const cleaned = message.replace(/^.*?TeX error:\s*/i, '').slice(0, 240);
  const error = el('render-error');
  error.textContent = cleaned;
  error.hidden = false;
  el('render-status').textContent = lastGood ? 'Last valid preview (downloads use this)' : 'Waiting for a valid equation';
  if (!lastGood) {
    const empty = document.createElement('span');
    empty.className = 'empty-preview';
    empty.textContent = 'Preview appears when the equation is valid.';
    el('preview').replaceChildren(empty);
  }
}
function queueRender(immediate = false) {
  clearTimeout(renderTimer);
  clearTimeout(timeout);
  const id = ++renderId;
  pending = true;
  el('render-error').hidden = true;
  button('retry').hidden = true;
  if (!source.trim()) {
    pending = false;
    lastGood = undefined;
    el('preview').innerHTML = '<span class="empty-preview">Write an equation to see its preview.</span>';
    el('render-status').textContent = 'No equation';
    updateExportControls();
    el('size-info').textContent = '';
    return;
  }
  el('render-status').textContent = lastGood ? 'Updating… (showing last valid preview)' : 'Rendering…';
  updateExportControls();
  renderTimer = setTimeout(() => {
    if (source.length > 20000) {
      pending = false;
      showRenderError('Keep the equation below 20,000 characters.');
      updateExportControls();
      return;
    }
    ensureWorker().postMessage({ id, source, display: settings.display });
    timeout = setTimeout(() => {
      worker?.terminate();
      worker = undefined;
      pending = false;
      showRenderError('Rendering took too long. Simplify the equation or check for a recursive macro.');
      button('retry').hidden = false;
      updateExportControls();
    }, hasRendered ? 2500 : 10000);
  }, immediate ? 0 : 100);
}
button('retry').addEventListener('click', () => queueRender(true));

function updatePreview() {
  const stage = el('preview-stage');
  const transparent = settings.background === 'transparent';
  stage.classList.toggle('checker', transparent);
  // A contrasting checkerboard also makes white-on-transparent equations visible.
  const rgb = settings.ink.match(/[0-9a-f]{2}/gi)!.map(n => parseInt(n, 16));
  stage.classList.toggle('checker-dark', transparent && rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722 > 150);
  stage.style.backgroundColor = transparent ? '' : settings.background;
  if (lastGood) {
    el('preview').innerHTML = buildSvg(lastGood, settings);
    const size = dimensions(lastGood, settings);
    el('size-info').textContent = `${size.width} × ${size.height} px`;
    requestAnimationFrame(snapPreview);
  }
  updateExportControls();
}
/** Snap the SVG to whole device pixels so hairlines and glyph edges stay crisp. */
function snapPreview() {
  const svg = el('preview').querySelector('svg');
  if (!svg) return;
  const ratio = window.devicePixelRatio || 1;
  svg.style.transform = 'none';
  const rect = svg.getBoundingClientRect();
  const dx = Math.round(rect.left * ratio) / ratio - rect.left;
  const dy = Math.round(rect.top * ratio) / ratio - rect.top;
  if (dx || dy) svg.style.transform = `translate(${dx}px, ${dy}px)`;
}
window.addEventListener('resize', () => requestAnimationFrame(snapPreview));
function syncControls() {
  select('theme').value = settings.theme;
  applyTheme();
  input('display').checked = settings.display;
  input('save-draft').checked = settings.saveDraft;
  input('ink').value = settings.ink;
  select('ink-preset').value = ['#000000', '#ffffff'].includes(settings.ink) ? settings.ink : 'custom';
  select('background-preset').value = ['transparent', '#000000', '#ffffff'].includes(settings.background) ? settings.background : 'custom';
  input('background').value = settings.background === 'transparent' ? '#ffffff' : settings.background;
  input('font-size').value = String(settings.fontSize);
  input('padding').value = String(settings.padding);
  select('scale').value = String(settings.scale);
  select('format').value = settings.format;
  input('quality').value = String(settings.quality);
  el('quality-value').textContent = `${settings.quality}%`;
  updatePreview();
}
function appearanceChanged() { updatePreview(); save(); }
select('theme').addEventListener('change', () => { settings.theme = select('theme').value; applyTheme(); save(); });
input('display').addEventListener('change', () => { settings.display = input('display').checked; queueRender(); save(); });
input('save-draft').addEventListener('change', () => { settings.saveDraft = input('save-draft').checked; save(); });
for (const kind of ['ink', 'background'] as const) {
  select(`${kind}-preset`).addEventListener('change', () => {
    const value = select(`${kind}-preset`).value;
    settings[kind] = value === 'custom' ? input(kind).value : value;
    if (settings[kind] !== 'transparent') input(kind).value = settings[kind];
    appearanceChanged();
  });
  input(kind).addEventListener('input', () => {
    settings[kind] = input(kind).value;
    select(`${kind}-preset`).value = 'custom';
    appearanceChanged();
  });
}
for (const [id, key, min, max] of [['font-size', 'fontSize', 8, 200], ['padding', 'padding', 0, 200]] as const) {
  input(id).addEventListener('input', () => {
    if (input(id).value === '' || !input(id).validity.valid) return;
    settings[key] = clamp(Number(input(id).value), min, max, settings[key]);
    appearanceChanged();
  });
  input(id).addEventListener('change', () => { input(id).value = String(settings[key]); });
}
select('format').addEventListener('change', () => { settings.format = select('format').value; updateExportControls(); save(); });
select('scale').addEventListener('change', () => { settings.scale = Number(select('scale').value); updateExportControls(); save(); });
input('quality').addEventListener('input', () => { settings.quality = Number(input('quality').value); el('quality-value').textContent = `${settings.quality}%`; save(); });

function updateExportControls() {
  const format = settings.format;
  const raster = ['png', 'jpg', 'webp'].includes(format);
  el('quality-control').hidden = !['jpg', 'webp'].includes(format);
  button('download').disabled = format === 'tex' ? !source.trim() : !lastGood;
  button('download').textContent = `Download ${format === 'tex' ? '.tex' : format.toUpperCase()}`;
  button('copy-image').disabled = !lastGood;
  button('copy-image').hidden = !('ClipboardItem' in window && navigator.clipboard?.write);
  const opaqueJpg = format === 'jpg' && settings.background === 'transparent';
  const completed = Boolean(lastGood?.completed) && format !== 'tex';
  el('export-note').textContent = opaqueJpg
    ? 'JPG cannot be transparent. This download will have a white background.'
    : completed ? 'The preview filled in missing closers; this export uses the completed equation.'
    : format === 'svg' ? 'SVG stays sharp at any size.'
    : format === 'tex' ? 'Downloads your current LaTeX source, including unfinished edits.'
    : 'Image scale increases the resolution without changing the equation.';
  // Only surface information that requires attention; general export help stays in the menu.
  el('export-note').hidden = !(opaqueJpg || completed);
  if (lastGood && raster) {
    const size = dimensions(lastGood, settings);
    el('export-size').textContent = `${Math.ceil(size.width * settings.scale)} × ${Math.ceil(size.height * settings.scale)} px`;
  } else el('export-size').textContent = '';
}
let exporting = false;
async function exportCurrent() {
  if (exporting || button('download').disabled) return;
  const format = settings.format;
  const equation = lastGood;
  const options = { ...settings };
  const filename = input('filename').value.trim().replace(/[^a-zA-Z0-9_\- .]/g, '_').replace(/\.(svg|png|jpe?g|webp|tex)$/i, '').replace(/^\.+|\.+$/g, '') || 'equation';
  exporting = true;
  button('download').disabled = true;
  button('download').textContent = 'Preparing…';
  try {
    if (format === 'tex') download(new Blob([source], { type: 'text/plain;charset=utf-8' }), `${filename}.tex`);
    else if (equation) {
      const blob = format === 'svg'
        ? new Blob([buildSvg(equation, options)], { type: 'image/svg+xml' })
        : await imageBlob(equation, options, format as 'png' | 'jpg' | 'webp', options.quality / 100);
      download(blob, `${filename}.${format}`);
    }
    notice(format !== 'tex' && (pending || equation?.source !== source)
      ? 'Downloaded the last valid preview.'
      : equation?.completed && format !== 'tex' ? 'Downloaded the auto-completed preview.' : 'Download ready.');
  } catch (error) { notice(error instanceof Error ? error.message : 'Download failed. Try SVG instead.'); }
  finally { exporting = false; updateExportControls(); }
}
button('download').addEventListener('click', () => void exportCurrent());
async function copyText(text: string, success: string) {
  try { await navigator.clipboard.writeText(text); notice(success); }
  catch { notice('Clipboard unavailable. Select the source and copy it with your keyboard.'); }
}
button('copy-source').addEventListener('click', () => void copyText(source, 'LaTeX copied.'));
button('share').addEventListener('click', () => {
  const { ink, background, fontSize, padding, display } = settings;
  const hash = `#equation=${encodeURIComponent(JSON.stringify({ source, appearance: { ink, background, fontSize, padding, display } }))}`;
  const url = `${location.origin}${location.pathname}${hash}`;
  if (url.length > 12000) { notice('Equation too long for a share link. Download the .tex source instead.'); return; }
  void copyText(url, 'Link copied. Anyone with it can read this equation.');
});
button('copy-image').addEventListener('click', async () => {
  if (!lastGood) return;
  const stale = pending || lastGood.source !== source;
  button('copy-image').disabled = true;
  try {
    // Pass a Promise to preserve the click's user activation in Safari.
    const item = new ClipboardItem({ 'image/png': imageBlob(lastGood, { ...settings }, 'png') });
    await navigator.clipboard.write([item]);
    notice(stale ? 'Last valid preview copied as PNG.' : lastGood.completed ? 'Auto-completed preview copied as PNG.' : 'Image copied as PNG.');
  } catch (error) { notice(error instanceof Error && error.message.startsWith('Image too large') ? error.message : 'Image clipboard unavailable. Download PNG instead.'); }
  finally { updateExportControls(); }
});

syncControls();
showTemplates();
updateCount();
queueRender(true);
if (!storageAvailable) el('save-status').textContent = 'Browser storage unavailable';
else el('save-status').textContent = shared ? 'Shared equation loaded' : settings.saveDraft ? 'Draft stays in this browser' : 'Draft saving off';
