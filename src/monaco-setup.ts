// Monaco's default entry bundles ~90 languages and an LSP client the equation
// editor never uses. Import the editor API plus the editor features only.
import 'monaco-editor/editor/editor.api.js';
import 'monaco-editor/features/register.all.js';
