import './monaco-setup';
import * as monaco from 'monaco-editor/editor/editor.api.js';
import EditorWorker from 'monaco-editor/editor/editor.worker.js?worker';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/700.css';
import '@fontsource/jetbrains-mono/400-italic.css';
import { templates } from './templates';

const LATEX = 'latex';
export const EDITOR_FONT = '"JetBrains Mono", ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace';

export interface EditorHandle {
  getValue(): string;
  /** Non-undoable replacement, used by tests and initial sync. */
  setValue(value: string): void;
  /** Undoable replacement, used by Clear and Load example. */
  replaceAll(value: string): void;
  insertTemplate(latex: string): void;
  getSelectionText(): string;
  focus(): void;
}

declare global {
  interface Window { __latexEditor?: EditorHandle }
}

interface MonacoEnvironmentShape { getWorker(): Worker }
(self as unknown as { MonacoEnvironment: MonacoEnvironmentShape }).MonacoEnvironment = {
  getWorker: () => new EditorWorker(),
};

/** Commands that expand into an editable snippet with placeholders. */
const snippetCommands: Record<string, string> = {
  frac: '\\frac{${1:a}}{${2:b}}',
  sqrt: '\\sqrt{${1:x}}',
  sum: '\\sum_{${1:i=1}}^{${2:n}} ${3:x_i}',
  prod: '\\prod_{${1:i=1}}^{${2:n}} ${3:x_i}',
  int: '\\int_{${1:a}}^{${2:b}} ${3:f(x)}\\,dx',
  lim: '\\lim_{${1:x \\to 0}} ${2:f(x)}',
  text: '\\text{${1:word}}',
  mathbb: '\\mathbb{${1:R}}',
  mathbf: '\\mathbf{${1:x}}',
  overline: '\\overline{${1:x}}',
  vec: '\\vec{${1:v}}',
  begin: '\\begin{${1:aligned}}\n${2:a &= b} \\\\\n${3:c &= d}\n\\end{${1:aligned}}',
};

const commandNames = [...new Set<string>([
  ...templates.flatMap(template => [...template.latex.matchAll(/\\([a-zA-Z]+)/g)].map(match => match[1])),
  ...Object.keys(snippetCommands),
  'sin', 'cos', 'tan', 'arcsin', 'arccos', 'arctan', 'sinh', 'cosh', 'tanh',
  'log', 'ln', 'exp', 'det', 'max', 'min', 'sup', 'inf', 'langle', 'rangle', 'lVert', 'rVert',
  'rightarrow', 'leftarrow', 'leftrightarrow', 'Rightarrow', 'Leftarrow', 'Leftrightarrow', 'to', 'mapsto',
  'ldots', 'cdots', 'vdots', 'ddots', 'underbrace', 'overbrace', 'underset', 'overset', 'displaystyle',
  'operatorname', 'color', 'boxed', 'cancel', 'binom', 'dfrac', 'tfrac', 'partial', 'nabla', 'hbar', 'ell',
])].sort();

/** Most-used snippets first, the rest alphabetical. */
const snippetOrder = ['frac', 'sqrt', 'int', 'sum', 'prod', 'lim', 'text', 'vec', 'mathbb', 'mathbf', 'overline', 'begin'];
const sortKey = (command: string) => {
  const index = snippetOrder.indexOf(command);
  if (index >= 0) return `0${String(index).padStart(2, '0')}`;
  return `${command in snippetCommands ? '1' : '2'}${command}`;
};

const latexConfiguration: monaco.languages.LanguageConfiguration = {
  comments: { lineComment: '%' },
  brackets: [['{', '}'], ['[', ']'], ['(', ')']],
  autoClosingPairs: [
    { open: '{', close: '}' },
    { open: '[', close: ']' },
    { open: '(', close: ')' },
  ],
  surroundingPairs: [
    { open: '{', close: '}' },
    { open: '[', close: ']' },
    { open: '(', close: ')' },
  ],
};

const latexTokens: monaco.languages.IMonarchLanguage = {
  defaultToken: '',
  brackets: [
    { open: '{', close: '}', token: 'delimiter.curly' },
    { open: '[', close: ']', token: 'delimiter.square' },
    { open: '(', close: ')', token: 'delimiter.parenthesis' },
  ],
  tokenizer: {
    root: [
      [/%.*$/, 'comment'],
      [/\\(?:begin|end)(?=\s*\{)/, 'keyword'],
      [/\\(?:[a-zA-Z@]+|.)/, 'keyword'],
      [/\$\$?/, 'string'],
      [/[{}]/, 'delimiter.curly'],
      [/[[\]()]/, 'delimiter.parenthesis'],
      [/[&^_~]/, 'operator'],
      [/-?\d+(?:\.\d+)?/, 'number'],
      [/[a-zA-Z]+/, 'identifier'],
    ],
  },
};

const themes: Record<'light' | 'dark', monaco.editor.IStandaloneThemeData> = {
  light: {
    base: 'vs',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '767676', fontStyle: 'italic' },
      { token: 'keyword', foreground: '1f5fa8' },
      { token: 'string', foreground: '8a5a00' },
      { token: 'number', foreground: '8a5a00' },
      { token: 'operator', foreground: '6b6b6b' },
    ],
    colors: {
      'editor.background': '#ffffff',
      'editor.foreground': '#202020',
      'editorCursor.foreground': '#202020',
      'editor.selectionBackground': '#b7d4f2',
      'editor.inactiveSelectionBackground': '#dbe7f4',
      'editor.selectionHighlightBackground': '#e2e2e2',
      'editor.lineHighlightBackground': '#f2f2f2',
      'editorLineNumber.foreground': '#8f8f8f',
      'editorLineNumber.activeForeground': '#4a4a4a',
      'editorWidget.background': '#ffffff',
      'editorWidget.border': '#b9b9b9',
      'editorSuggestWidget.background': '#ffffff',
      'editorSuggestWidget.border': '#b9b9b9',
      'editorSuggestWidget.foreground': '#202020',
      'editorSuggestWidget.selectedForeground': '#202020',
      'editorSuggestWidget.selectedBackground': '#d7e6f6',
      'editorSuggestWidget.focusHighlightForeground': '#235b97',
      'editorSuggestWidget.highlightForeground': '#235b97',
      'editorHoverWidget.background': '#ffffff',
      'editorHoverWidget.border': '#b9b9b9',
      'scrollbarSlider.background': '#c9c9c955',
      'scrollbarSlider.hoverBackground': '#b5b5b5aa',
      'scrollbarSlider.activeBackground': '#9d9d9daa',
      'editorBracketMatch.background': '#e2ecf7',
      'editorBracketMatch.border': '#235b97',
    },
  },
  dark: {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '9a9a9a', fontStyle: 'italic' },
      { token: 'keyword', foreground: 'a6c9ef' },
      { token: 'string', foreground: 'e0b879' },
      { token: 'number', foreground: 'e0b879' },
      { token: 'operator', foreground: 'a8a8a8' },
    ],
    colors: {
      'editor.background': '#292929',
      'editor.foreground': '#eeeeee',
      'editorCursor.foreground': '#eeeeee',
      'editor.selectionBackground': '#3f5c7c',
      'editor.inactiveSelectionBackground': '#37475a',
      'editor.selectionHighlightBackground': '#3a3a3a',
      'editor.lineHighlightBackground': '#313131',
      'editorLineNumber.foreground': '#8a8a8a',
      'editorLineNumber.activeForeground': '#c9c9c9',
      'editorWidget.background': '#2f2f2f',
      'editorWidget.border': '#737373',
      'editorSuggestWidget.background': '#2f2f2f',
      'editorSuggestWidget.border': '#737373',
      'editorSuggestWidget.foreground': '#eeeeee',
      'editorSuggestWidget.selectedForeground': '#ffffff',
      'editorSuggestWidget.selectedBackground': '#3d5b7c',
      'editorSuggestWidget.focusHighlightForeground': '#a6c9ef',
      'editorSuggestWidget.highlightForeground': '#a6c9ef',
      'editorHoverWidget.background': '#2f2f2f',
      'editorHoverWidget.border': '#737373',
      'scrollbarSlider.background': '#5a5a5a55',
      'scrollbarSlider.hoverBackground': '#6d6d6daa',
      'scrollbarSlider.activeBackground': '#808080aa',
      'editorBracketMatch.background': '#3d5b7c',
      'editorBracketMatch.border': '#a6c9ef',
    },
  },
};

const completionProvider: monaco.languages.CompletionItemProvider = {
  triggerCharacters: ['\\'],
  provideCompletionItems(model, position, context) {
    const line = model.getLineContent(position.lineNumber).slice(0, position.column - 1);
    const match = /(\\?)([a-zA-Z]*)$/.exec(line);
    if (!match) return { suggestions: [] };
    const [text, backslash, word] = match;
    const explicit = context.triggerKind === monaco.languages.CompletionTriggerKind.Invoke;
    // Without a backslash, only an explicit request (Ctrl+Space) suggests commands,
    // so Tab never surprises someone typing plain letters.
    if (!backslash && !explicit) return { suggestions: [] };
    const range = new monaco.Range(position.lineNumber, position.column - text.length, position.lineNumber, position.column);
    const prefix = word.toLowerCase();
    const suggestions: monaco.languages.CompletionItem[] = [];
    for (const command of commandNames) {
      if (prefix && !command.startsWith(prefix)) continue;
      const snippet = snippetCommands[command];
      suggestions.push({
        label: `\\${command}`,
        kind: snippet ? monaco.languages.CompletionItemKind.Snippet : monaco.languages.CompletionItemKind.Function,
        detail: snippet ? 'snippet' : 'command',
        insertText: snippet ?? `\\${command}`,
        ...(snippet ? { insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet } : {}),
        filterText: `\\${command}`,
        sortText: sortKey(command),
        range,
      });
      if (suggestions.length >= 200) break;
    }
    return { suggestions };
  },
};

monaco.languages.register({ id: LATEX, extensions: ['.tex'], aliases: ['LaTeX'] });
monaco.languages.setLanguageConfiguration(LATEX, latexConfiguration);
monaco.languages.setMonarchTokensProvider(LATEX, latexTokens);
monaco.languages.registerCompletionItemProvider(LATEX, completionProvider);
monaco.editor.defineTheme('latex-light', themes.light);
monaco.editor.defineTheme('latex-dark', themes.dark);

export function setEditorTheme(dark: boolean) {
  monaco.editor.setTheme(dark ? 'latex-dark' : 'latex-light');
}

const FONT_SPECS = ['15px "JetBrains Mono"', 'bold 15px "JetBrains Mono"', 'italic 15px "JetBrains Mono"'];

/**
 * The editor's metrics depend on the font that is actually rendered. Monaco
 * caches character widths when the editor is created, so a font that swaps in
 * afterwards leaves clicks and the caret offset from the text under the
 * pointer. Wait for the font before creating the editor.
 */
export async function loadEditorFont(): Promise<void> {
  try {
    await Promise.all(FONT_SPECS.map(spec => document.fonts.load(spec)));
  } catch {
    // Fall back to the default monospace metrics rather than blocking the editor.
  }
}

export interface EditorOptions {
  value: string;
  dark: boolean;
  onInput(value: string): void;
  onRenderRequest(): void;
  onDownloadRequest(): void;
}

export function createEditor(parent: HTMLElement, options: EditorOptions): EditorHandle {
  const editor = monaco.editor.create(parent, {
    value: options.value,
    language: LATEX,
    theme: options.dark ? 'latex-dark' : 'latex-light',
    ariaLabel: 'LaTeX source',
    automaticLayout: true,
    minimap: { enabled: false },
    glyphMargin: false,
    folding: false,
    stickyScroll: { enabled: false },
    lineDecorationsWidth: 6,
    lineNumbersMinChars: 3,
    renderLineHighlight: 'line',
    wordWrap: 'on',
    wrappingIndent: 'none',
    scrollBeyondLastLine: false,
    smoothScrolling: true,
    overviewRulerLanes: 0,
    overviewRulerBorder: false,
    hideCursorInOverviewRuler: true,
    scrollbar: { verticalScrollbarSize: 10, useShadows: false, alwaysConsumeMouseWheel: false },
    fontSize: 15,
    lineHeight: 24,
    fontFamily: EDITOR_FONT,
    fontLigatures: false,
    tabSize: 2,
    wordBasedSuggestions: 'off',
    quickSuggestions: { other: true, comments: false, strings: true },
    suggestOnTriggerCharacters: true,
    acceptSuggestionOnEnter: 'on',
    tabCompletion: 'on',
    suggest: { preview: false, showStatusBar: false },
    padding: { top: 10, bottom: 10 },
    unicodeHighlight: { ambiguousCharacters: false, invisibleCharacters: false, nonBasicASCII: false },
    fixedOverflowWidgets: true,
    contextmenu: true,
  });

  editor.onDidChangeModelContent(() => options.onInput(editor.getValue()));
  // Keep one line-ending style so downloads, share links, and diffs stay portable.
  editor.getModel()?.setEOL(monaco.editor.EndOfLineSequence.LF);
  // If any face loads later (a text subset, a slow retry), re-measure so
  // hit-testing keeps matching what is on screen.
  void document.fonts?.ready.then(() => monaco.editor.remeasureFonts());
  document.fonts?.addEventListener('loadingdone', () => monaco.editor.remeasureFonts());
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => options.onRenderRequest());
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyS, () => options.onDownloadRequest());
  // Tab accepts the highlighted suggestion (Monaco's built-in binding, enabled by
  // tabCompletion: 'on') and then walks through snippet placeholders.
  // Escape clears a selection, then leaves the editor so keyboard users are never trapped.
  editor.addCommand(monaco.KeyCode.Escape, () => {
    const selection = editor.getSelection();
    if (selection && !selection.isEmpty()) {
      editor.setSelection(new monaco.Selection(selection.startLineNumber, selection.startColumn, selection.startLineNumber, selection.startColumn));
      return;
    }
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  }, 'editorTextFocus && !suggestWidgetVisible && !parameterHintsVisible && !snippetMode && !findWidgetVisible');

  const handle: EditorHandle = {
    getValue: () => editor.getValue(),
    setValue: value => {
      const model = editor.getModel();
      if (!model) return;
      model.setValue(value);
      // Leave the cursor where a person would be after typing, at the end.
      const lastLine = model.getLineCount();
      editor.setPosition({ lineNumber: lastLine, column: model.getLineMaxColumn(lastLine) });
    },
    replaceAll(value) {
      const model = editor.getModel();
      if (!model) return;
      editor.pushUndoStop();
      editor.executeEdits('replace-all', [{ range: model.getFullModelRange(), text: value, forceMoveMarkers: true }]);
      editor.pushUndoStop();
      const lastLine = model.getLineCount();
      editor.setPosition({ lineNumber: lastLine, column: model.getLineMaxColumn(lastLine) });
    },
    insertTemplate(latex) {
      const model = editor.getModel();
      const selection = editor.getSelection();
      if (!model || !selection) return;
      const selected = model.getValueInRange(selection);
      const startOffset = model.getOffsetAt(selection.getStartPosition());
      const placeholder = /(?<=\{)(a|x|n|word|v)(?=\})/.exec(latex);
      let insertion = latex;
      let start = latex.length;
      let length = 0;
      if (placeholder) {
        start = placeholder.index;
        length = placeholder[0].length;
        if (selected) {
          insertion = latex.slice(0, start) + selected + latex.slice(start + length);
          length = selected.length;
        }
      }
      editor.pushUndoStop();
      editor.executeEdits('insert-template', [{ range: selection, text: insertion, forceMoveMarkers: true }]);
      editor.pushUndoStop();
      const from = model.getPositionAt(startOffset + start);
      const to = model.getPositionAt(startOffset + start + length);
      editor.setSelection(new monaco.Selection(from.lineNumber, from.column, to.lineNumber, to.column));
      editor.revealPositionInCenterIfOutsideViewport(from);
      editor.focus();
    },
    getSelectionText() {
      const model = editor.getModel();
      const selection = editor.getSelection();
      return model && selection ? model.getValueInRange(selection) : '';
    },
    focus: () => editor.focus(),
  };
  window.__latexEditor = handle;
  return handle;
}
