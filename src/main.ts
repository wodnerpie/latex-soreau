import { EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine, drawSelection } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { StreamLanguage, bracketMatching } from '@codemirror/language';
import { stexMath } from '@codemirror/legacy-modes/mode/stex';
import { autocompletion, completionKeymap, snippetCompletion, type CompletionContext } from '@codemirror/autocomplete';
import { templates, examples } from './templates';
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
      <button id="share" type="button" title="Copy a link containing the current equation and appearance">Copy link</button>
      <label class="inline-label" for="theme">Theme <select id="theme"><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select></label>
    </div>
  </header>
  <main>
    <div class="workspace">
      <section class="source-panel" aria-labelledby="source-title">
        <div class="panel-heading">
          <h2 id="source-title">LaTeX</h2>
          <div class="actions"><button id="copy-source" type="button">Copy LaTeX</button><button id="clear" type="button" title="Clear the editor (undo to restore)">Clear</button></div>
        </div>
        <div id="editor"></div>
        <div class="editor-footer"><span>Type <kbd>\\</kbd> for commands. <kbd>Ctrl</kbd>+<kbd>Space</kbd> for autocomplete.</span><span id="char-count"></span></div>
        <details id="insert-tools" open>
          <summary>Insert symbols &amp; templates</summary>
          <div class="template-filters">
            <label class="sr-only" for="category">Template category</label>
            <select id="category"><option>Structure</option><option>Calculus</option><option>Symbols</option><option>Greek</option><option>Sets</option><option>Layouts</option><option>All</option></select>
            <label class="sr-only" for="template-search">Search templates</label>
            <input id="template-search" type="search" placeholder="Search templates…" autocomplete="off" />
          </div>
          <div id="templates" class="template-list"></div>
        </details>
        <div class="example-row">
          <label for="examples">Examples</label>
          <select id="examples"><option value="">Choose an example…</option></select>
          <button id="load-example" type="button" disabled>Load</button>
        </div>
      </section>
      <section class="preview-panel" aria-labelledby="preview-title">
        <div class="panel-heading"><h2 id="preview-title">Preview</h2><label class="checkbox"><input id="display" type="checkbox" checked /> Display style</label></div>
        <div id="preview-stage" class="checker"><div id="preview"><span class="empty-preview">Rendering equation…</span></div></div>
        <div class="preview-status"><span id="render-status" role="status" aria-live="polite">Loading renderer…</span><button id="retry" type="button" hidden>Retry</button><span id="size-info"></span></div>
        <div id="render-error" role="status" aria-live="polite" hidden></div>
        <fieldset class="appearance"><legend>Appearance</legend>
          <div class="control"><label for="ink-preset">Equation color</label><div class="color-control"><select id="ink-preset"><option value="#000000">Black</option><option value="#ffffff">White</option><option value="custom">Custom</option></select><input type="color" id="ink" aria-label="Custom equation color" value="#000000" /></div></div>
          <div class="control"><label for="background-preset">Background</label><div class="color-control"><select id="background-preset"><option value="transparent">Transparent</option><option value="#ffffff">White</option><option value="#000000">Black</option><option value="custom">Custom</option></select><input type="color" id="background" aria-label="Custom background color" value="#ffffff" /></div></div>
          <div class="control"><label for="font-size">Font size (px)</label><input id="font-size" type="number" min="8" max="200" value="32" /></div>
          <div class="control"><label for="padding">Padding (px)</label><input id="padding" type="number" min="0" max="200" value="16" /></div>
        </fieldset>
        <fieldset class="export"><legend>Download</legend>
          <div class="export-controls">
            <div class="control"><label for="format">Format</label><select id="format"><option value="svg">SVG (vector)</option><option value="png">PNG</option><option value="jpg">JPG</option><option value="webp">WebP</option><option value="tex">LaTeX (.tex)</option></select></div>
            <div class="control"><label for="scale">Image scale</label><select id="scale"><option value="1">1×</option><option value="2" selected>2×</option><option value="3">3×</option><option value="4">4×</option><option value="8">8×</option></select></div>
            <div class="control"><label for="filename">Filename</label><input id="filename" type="text" value="equation" maxlength="80" spellcheck="false" /></div>
          </div>
          <div id="quality-control" class="quality-control" hidden><label for="quality">Quality <output id="quality-value">95%</output></label><input id="quality" type="range" min="10" max="100" value="95" /></div>
          <p id="export-note" class="hint">SVG stays sharp at any size.</p>
          <div class="download-actions"><button id="download" class="primary" type="button" disabled>Download SVG</button><button id="copy-image" type="button" disabled>Copy image</button><span id="export-size" class="hint"></span></div>
        </fieldset>
      </section>
    </div>
    <details class="help"><summary>Help &amp; shortcuts</summary><div class="help-content">
      <p>Write math directly, without <code>$</code> delimiters. Pasted <code>$…$</code>, <code>$$…$$</code>, <code>\\(…\\)</code>, and <code>\\[…\\]</code> also work. This is an equation editor, not a full LaTeX document compiler.</p>
      <p>Use <code>\\begin{aligned} … \\end{aligned}</code> for multiple lines, <code>&amp;</code> for alignment, and <code>\\\\</code> for line breaks. AMS math, matrices, cases, colors, and common physics commands are supported.</p>
      <p><kbd>Ctrl</kbd>+<kbd>Space</kbd> opens autocomplete. <kbd>Enter</kbd> accepts a suggestion. <kbd>Tab</kbd> moves between snippet fields; <kbd>Esc</kbd> then <kbd>Tab</kbd> leaves the editor. <kbd>Ctrl</kbd>+<kbd>Z</kbd> undoes edits, including loading an example or clearing. <kbd>Ctrl</kbd>+<kbd>Enter</kbd> renders immediately. <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>S</kbd> downloads. Use <kbd>⌘</kbd> instead of <kbd>Ctrl</kbd> on Mac.</p>
      <p>Incomplete equation? The last valid preview stays visible, and image downloads use that preview. A compact message explains what to fix. LaTeX downloads and Copy LaTeX always use your current text.</p>
      <p>Transparent backgrounds use a checkerboard here; it is never included in downloads. JPG cannot be transparent and uses white instead. Image scale affects raster downloads only; SVG is vector.</p>
      <p>Everything renders locally in your browser. No accounts, analytics, or equation uploads. Copy link includes the equation in the URL fragment; anyone with the link can read it. Links longer than 12,000 characters should be shared as a .tex file instead.</p>
    </div></details>
  </main>
  <footer><label class="checkbox"><input id="save-draft" type="checkbox" checked /> Save draft in this browser</label><span id="save-status"></span><a href="https://github.com/wodnerpie/latex-soreau" target="_blank" rel="noopener noreferrer">GitHub</a></footer>
  <div id="notice" role="status" aria-live="polite"></div>
`;

function el<T extends HTMLElement = HTMLElement>(id: string): T { return document.getElementById(id) as T; }
const input = (id: string) => el<HTMLInputElement>(id);
const select = (id: string) => el<HTMLSelectElement>(id);
const button = (id: string) => el<HTMLButtonElement>(id);
let noticeTimer: ReturnType<typeof setTimeout>;
function notice(message: string) {
  el('notice').textContent = message;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { el('notice').textContent = ''; }, 6000);
}

const snippetCommands: Record<string, string> = {
  frac: '\\frac{${a}}{${b}}', sqrt: '\\sqrt{${x}}', sum: '\\sum_{${i=1}}^{${n}} ${x_i}',
  prod: '\\prod_{${i=1}}^{${n}} ${x_i}', int: '\\int_{${a}}^{${b}} ${f(x)}\\,dx',
  lim: '\\lim_{${x \\to 0}} ${f(x)}', text: '\\text{${word}}', mathbb: '\\mathbb{${R}}',
  mathbf: '\\mathbf{${x}}', overline: '\\overline{${x}}', vec: '\\vec{${v}}',
  begin: '\\begin{${aligned}}\n${a &= b} \\\\\n${c &= d}\n\\end{${aligned}}',
};
const commands = new Set([
  ...templates.flatMap(t => [...t.latex.matchAll(/\\([a-zA-Z]+)/g)].map(m => m[1])),
  ...Object.keys(snippetCommands), 'sin', 'cos', 'tan', 'arcsin', 'arccos', 'arctan', 'sinh', 'cosh', 'tanh',
  'log', 'ln', 'exp', 'det', 'max', 'min', 'sup', 'inf', 'langle', 'rangle', 'lVert', 'rVert',
  'rightarrow', 'leftarrow', 'leftrightarrow', 'Rightarrow', 'Leftarrow', 'Leftrightarrow', 'to', 'mapsto',
  'ldots', 'cdots', 'vdots', 'ddots', 'underbrace', 'overbrace', 'underset', 'overset', 'displaystyle', 'operatorname', 'color', 'boxed', 'cancel', 'binom', 'dfrac', 'tfrac', 'partial', 'nabla', 'hbar', 'ell',
]);
function completions(context: CompletionContext) {
  const word = context.matchBefore(/\\[a-zA-Z]*/);
  if (!word || (word.from === word.to && !context.explicit)) return null;
  return {
    from: word.from,
    options: [...commands].map(command => snippetCommands[command]
      ? snippetCompletion(snippetCommands[command], { label: `\\${command}`, type: 'function', detail: 'template' })
      : { label: `\\${command}`, type: 'keyword' }),
    validFor: /^\\[a-zA-Z]*$/,
  };
}

let saveTimer: ReturnType<typeof setTimeout>;
const editor = new EditorView({
  parent: el('editor'),
  state: EditorState.create({
    doc: source,
    extensions: [
      lineNumbers(), history(), drawSelection(), highlightActiveLine(), EditorView.lineWrapping,
      StreamLanguage.define(stexMath), bracketMatching(),
      autocompletion({ override: [completions], activateOnTyping: true, interactionDelay: 0 }),
      keymap.of([
        ...completionKeymap, ...defaultKeymap, ...historyKeymap,
        { key: 'Escape', run: view => { view.contentDOM.blur(); return true; } },
        indentWithTab,
        { key: 'Mod-Enter', run: () => { queueRender(true); return true; } },
        { key: 'Mod-Shift-s', run: () => { void exportCurrent(); return true; } },
      ]),
      EditorView.contentAttributes.of({ 'aria-label': 'LaTeX source', 'aria-describedby': 'source-title', spellcheck: 'false', autocapitalize: 'off', autocorrect: 'off' }),
      EditorView.updateListener.of(update => {
        if (update.docChanged) {
          source = update.state.doc.toString();
          updateCount();
          queueRender();
          clearTimeout(saveTimer);
          saveTimer = setTimeout(save, 400);
          // Once edited, the old share link no longer describes the current draft.
          if (location.hash) historyReplace();
        }
      }),
    ],
  }),
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
  editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: value }, selection: { anchor: value.length } });
  editor.focus();
}

function insertTemplate(latex: string) {
  const selection = editor.state.selection.main;
  const selected = editor.state.sliceDoc(selection.from, selection.to);
  const placeholder = /(?<=\{)(a|x|n|word|v)(?=\})/.exec(latex);
  let insertion = latex;
  let start = latex.length;
  let length = 0;
  if (placeholder) {
    start = placeholder.index;
    length = placeholder[0].length;
    if (selected) { insertion = latex.slice(0, start) + selected + latex.slice(start + length); length = selected.length; }
  }
  editor.dispatch({ changes: { from: selection.from, to: selection.to, insert: insertion }, selection: { anchor: selection.from + start, head: selection.from + start + length }, scrollIntoView: true });
  editor.focus();
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
button('load-example').addEventListener('click', () => { if (examples[select('examples').value]) replaceSource(examples[select('examples').value]); });
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
      el('render-status').textContent = 'Up to date';
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
  }
  updateExportControls();
}
function syncControls() {
  select('theme').value = settings.theme;
  document.documentElement.dataset.theme = settings.theme;
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
select('theme').addEventListener('change', () => { settings.theme = select('theme').value; document.documentElement.dataset.theme = settings.theme; save(); });
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
  select('scale').disabled = !raster;
  el('quality-control').hidden = !['jpg', 'webp'].includes(format);
  button('download').disabled = format === 'tex' ? !source.trim() : !lastGood;
  button('download').textContent = `Download ${format === 'tex' ? '.tex' : format.toUpperCase()}`;
  button('copy-image').disabled = !lastGood;
  button('copy-image').hidden = !('ClipboardItem' in window && navigator.clipboard?.write);
  el('export-note').textContent = format === 'jpg' && settings.background === 'transparent'
    ? 'JPG cannot be transparent. This download will have a white background.'
    : format === 'svg' ? 'SVG stays sharp at any size.'
    : format === 'tex' ? 'Downloads your current LaTeX source, including unfinished edits.'
    : 'Image scale increases the resolution without changing the equation.';
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
    notice(format !== 'tex' && (pending || equation?.source !== source) ? 'Downloaded the last valid preview.' : 'Download ready.');
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
    notice(stale ? 'Last valid preview copied as PNG.' : 'Image copied as PNG.');
  } catch (error) { notice(error instanceof Error && error.message.startsWith('Image too large') ? error.message : 'Image clipboard unavailable. Download PNG instead.'); }
  finally { updateExportControls(); }
});

syncControls();
showTemplates();
updateCount();
queueRender(true);
if (!storageAvailable) el('save-status').textContent = 'Browser storage unavailable';
else el('save-status').textContent = shared ? 'Shared equation loaded' : settings.saveDraft ? 'Draft stays in this browser' : 'Draft saving off';
