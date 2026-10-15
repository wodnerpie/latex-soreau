import { mathjax } from 'mathjax-full/js/mathjax.js';
import { TeX } from 'mathjax-full/js/input/tex.js';
import { SVG } from 'mathjax-full/js/output/svg.js';
import { liteAdaptor } from 'mathjax-full/js/adaptors/liteAdaptor.js';
import { RegisterHTMLHandler } from 'mathjax-full/js/handlers/html.js';
import 'mathjax-full/js/input/tex/ams/AmsConfiguration.js';
import 'mathjax-full/js/input/tex/newcommand/NewcommandConfiguration.js';
import 'mathjax-full/js/input/tex/configmacros/ConfigMacrosConfiguration.js';
import 'mathjax-full/js/input/tex/cancel/CancelConfiguration.js';
import 'mathjax-full/js/input/tex/bbox/BboxConfiguration.js';
import 'mathjax-full/js/input/tex/boldsymbol/BoldsymbolConfiguration.js';
import 'mathjax-full/js/input/tex/mathtools/MathtoolsConfiguration.js';
import 'mathjax-full/js/input/tex/physics/PhysicsConfiguration.js';
import 'mathjax-full/js/input/tex/textmacros/TextMacrosConfiguration.js';
import 'mathjax-full/js/input/tex/unicode/UnicodeConfiguration.js';
import 'mathjax-full/js/input/tex/color/ColorConfiguration.js';

export interface RenderedEquation {
  svg: string;
  viewBox: [number, number, number, number];
  source: string;
}

const adaptor = liteAdaptor();
RegisterHTMLHandler(adaptor);

export function normalizeSource(source: string): string {
  const value = source.trim();
  for (const [open, close] of [['$$', '$$'], ['\\[', '\\]'], ['\\(', '\\)'], ['$', '$']]) {
    if (value.startsWith(open) && value.endsWith(close) && value.length >= open.length + close.length) {
      return value.slice(open.length, -close.length).trim();
    }
  }
  return value;
}

export function renderEquation(source: string, display: boolean): RenderedEquation {
  const normalized = normalizeSource(source);
  if (!normalized) throw new Error('Write an equation to see its preview.');
  if (normalized.length > 20000) throw new Error('Keep the equation below 20,000 characters.');
  // New input/document per conversion prevents user-defined macros leaking between drafts.
  // No HTML, URLs, dynamic package loading, or arbitrary style injection.
  const tex = new TeX({
    packages: ['base', 'ams', 'newcommand', 'configmacros', 'cancel', 'bbox', 'boldsymbol', 'mathtools', 'physics', 'textmacros', 'unicode', 'color'],
    maxBuffer: 20 * 1024,
    maxMacros: 1000,
    // MathJax's TeXError has a message but does not inherit from JavaScript Error.
    formatError: (_jax: unknown, error: { message: string }) => { throw new Error(error.message); },
  });
  const doc = mathjax.document('', { InputJax: tex, OutputJax: new SVG({ fontCache: 'none' }) });
  const node = doc.convert(normalized, { display, em: 16, ex: 8, containerWidth: 100000 });
  const svgNode = adaptor.tags(node, 'svg')[0];
  if (!svgNode) throw new Error('Could not render this equation.');
  const viewBox: number[] | undefined = (adaptor.getAttribute(svgNode, 'viewBox') as string | undefined)?.split(/\s+/).map(Number);
  if (!viewBox || viewBox.length !== 4 || viewBox.some(n => !Number.isFinite(n)) || viewBox[2] <= 0 || viewBox[3] <= 0) {
    throw new Error('The equation has no visible output.');
  }
  return { svg: adaptor.outerHTML(svgNode), viewBox: viewBox as RenderedEquation['viewBox'], source };
}
