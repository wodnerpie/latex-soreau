import { defineConfig } from 'vite';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const mathjaxVersion = require('mathjax-full/package.json').version as string;

export default defineConfig({
  // MathJax's Node entry otherwise uses eval('require') to read its package version.
  // Defining it at build time keeps the worker browser-only and compatible with strict CSP.
  define: { PACKAGE_VERSION: JSON.stringify(mathjaxVersion) },
});
