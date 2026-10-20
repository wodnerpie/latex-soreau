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
  /** The completed source when the preview needed missing closers appended. */
  completed?: string;
}

type OpenConstruct =
  | { kind: 'brace' }
  | { kind: 'left'; close: string }
  | { kind: 'environment'; name: string };

const rightDelimiters: Record<string, string> = {
  '(': ')', '[': ']', '\\{': '\\}', '|': '|', '\\|': '\\|', '.': '.', '/': '/', '<': '>',
  '\\lbrace': '\\rbrace', '\\lbrack': '\\rbrack', '\\langle': '\\rangle',
  '\\lvert': '\\rvert', '\\lVert': '\\rVert', '\\lfloor': '\\rfloor', '\\lceil': '\\rceil',
  '\\lgroup': '\\rgroup', '\\lmoustache': '\\rmoustache',
  '\\uparrow': '\\downarrow', '\\downarrow': '\\uparrow', '\\updownarrow': '\\updownarrow',
  '\\Uparrow': '\\Downarrow', '\\Downarrow': '\\Uparrow', '\\Updownarrow': '\\Updownarrow',
};

function readDelimiter(source: string, start: number): { value: string; end: number } | undefined {
  let index = start;
  while (index < source.length && /\s/.test(source[index])) index += 1;
  if (index >= source.length) return undefined;
  if (source[index] === '\\') {
    const match = /^\\(?:[a-zA-Z]+|.)/.exec(source.slice(index));
    return match ? { value: match[0], end: index + match[0].length } : undefined;
  }
  return /^[()[\]{}|./<>]$/.test(source[index]) ? { value: source[index], end: index + 1 } : undefined;
}

function readEnvironmentName(source: string, start: number): { name: string; end: number } | undefined {
  let index = start;
  while (index < source.length && /\s/.test(source[index])) index += 1;
  if (source[index] !== '{') return undefined;
  const close = source.indexOf('}', index + 1);
  if (close < 0) return undefined;
  const name = source.slice(index + 1, close).trim();
  return name ? { name, end: close + 1 } : undefined;
}

/**
 * Appends the closers that turn a half-written equation into one MathJax can
 * render: `}`, `\right…`, and `\end{…}`. Returns undefined when nothing is open.
 * Comments and escaped braces are skipped so they never affect the stack.
 */
export function completeIncompleteSource(source: string): string | undefined {
  const stack: OpenConstruct[] = [];
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    if (char === '%') {
      const newline = source.indexOf('\n', index);
      index = newline < 0 ? source.length : newline + 1;
      continue;
    }
    if (char === '\\') {
      const command = /^\\(?:[a-zA-Z]+|.)/.exec(source.slice(index))?.[0];
      if (!command) { index += 1; continue; }
      if (command === '\\begin' || command === '\\end') {
        const argument = readEnvironmentName(source, index + command.length);
        if (argument) {
          if (command === '\\begin') stack.push({ kind: 'environment', name: argument.name });
          else {
            for (let open = stack.length - 1; open >= 0; open -= 1) {
              const entry = stack[open];
              if (entry.kind === 'environment' && entry.name === argument.name) {
                stack.splice(open, 1);
                break;
              }
            }
          }
          index = argument.end;
          continue;
        }
      } else if (command === '\\left') {
        const delimiter = readDelimiter(source, index + command.length);
        if (delimiter) {
          stack.push({ kind: 'left', close: rightDelimiters[delimiter.value] ?? '.' });
          index = delimiter.end;
          continue;
        }
      } else if (command === '\\right') {
        const delimiter = readDelimiter(source, index + command.length);
        if (delimiter) {
          for (let open = stack.length - 1; open >= 0; open -= 1) {
            if (stack[open].kind === 'left') { stack.splice(open, 1); break; }
          }
          index = delimiter.end;
          continue;
        }
      }
      index += command.length;
      continue;
    }
    if (char === '{') stack.push({ kind: 'brace' });
    else if (char === '}' && stack.at(-1)?.kind === 'brace') stack.pop();
    index += 1;
  }

  // A trailing ^ or _ still needs an argument before any enclosing group closes.
  const tail = source.trimEnd();
  let suffix = tail.endsWith('^') || tail.endsWith('_') ? '{}' : '';
  for (let open = stack.length - 1; open >= 0; open -= 1) {
    const entry = stack[open];
    if (entry.kind === 'brace') suffix += '}';
    else if (entry.kind === 'left') suffix += `\\right${entry.close}`;
    else suffix += `\\end{${entry.name}}`;
  }
  return suffix ? source + suffix : undefined;
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

/**
 * Strict rendering first, then one repair attempt for equations that are still
 * being typed. Only missing closers are added; real syntax errors still throw.
 */
export function renderPreview(source: string, display: boolean): RenderedEquation {
  try {
    return renderEquation(source, display);
  } catch (originalError) {
    const normalized = normalizeSource(source);
    if (!normalized || normalized.length > 20000) throw originalError;
    const completed = completeIncompleteSource(normalized);
    if (!completed || completed === normalized) throw originalError;
    try {
      return { ...renderEquation(completed, display), source, completed };
    } catch {
      throw originalError;
    }
  }
}
