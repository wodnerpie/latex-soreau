import { describe, expect, it } from 'vitest';
import { completeIncompleteSource, normalizeSource, renderEquation, renderPreview } from '../src/render';
import { buildSvg, dimensions } from '../src/export';
import { examples, templates } from '../src/templates';

describe('equation rendering', () => {
  for (const [name, source] of Object.entries(examples)) {
    it(`renders example: ${name}`, () => {
      const result = renderEquation(source, true);
      expect(result.svg).toContain('<path');
      expect(result.svg).not.toContain('data-mml-node="merror"');
      expect(result.viewBox[2]).toBeGreaterThan(0);
      expect(result.viewBox[3]).toBeGreaterThan(0);
    });
  }
  it('renders every quick-insert template', () => {
    for (const template of templates) expect(() => renderEquation(template.latex, true), template.label).not.toThrow();
  });
  it.each(['\\frac{a}{', '\\notarealcommand{x}', '\\begin{pmatrix}a & b', 'x^{'])('rejects invalid input without rendering a giant error: %s', source => {
    expect(() => renderEquation(source, true)).toThrow();
  });
  it.each(['$$x^2$$', '$x^2$', '\\[x^2\\]', '\\(x^2\\)'])('accepts delimiters: %s', source => {
    expect(normalizeSource(source)).toBe('x^2');
    expect(renderEquation(source, false).svg).toContain('<path');
  });
  it('does not share user-defined macros between conversions', () => {
    expect(renderEquation('\\newcommand{\\foo}{x}\\foo', true).svg).toContain('<path');
    expect(() => renderEquation('\\foo', true)).toThrow();
  });
  it('caps macro expansion and input length', () => {
    expect(() => renderEquation('\\def\\x{\\x}\\x', true)).toThrow();
    expect(() => renderEquation('x'.repeat(20001), true)).toThrow(/20,000/);
  });
  it('preserves actionable MathJax syntax errors as standard Error objects', () => {
    expect(() => renderEquation('\\unknowncommand{x}', true)).toThrow(/Undefined control sequence/);
    expect(() => renderEquation('\\frac{a}{', true)).toThrow(/Missing close brace/);
  });
  it.each(['\\href{javascript:alert(1)}{x}', '\\htmlClass{test}{x}', '\\require{html}'])('disables HTML and external links: %s', source => {
    expect(() => renderEquation(source, true)).toThrow();
  });
});

describe('explicit line breaks', () => {
  it.each([true, false])('lays out bare line breaks as rows (display: %s)', display => {
    const source = String.raw`a = b \\ c = d \\ e = f`;
    const result = renderEquation(source, display);
    const environment = display ? 'gathered' : 'matrix';
    const expected = renderEquation(`\\begin{${environment}}${source}\\end{${environment}}`, display);
    expect(result.svg).toBe(expected.svg);
    expect(result.svg.match(/data-mml-node="mtr"/g)).toHaveLength(3);
    expect(result.viewBox[3]).toBeGreaterThan(renderEquation('a = b', display).viewBox[3] * 2);
    expect(result.source).toBe(source);
  });
  it.each([String.raw`a \\[1em] b`, String.raw`a \\*[1em] b`, String.raw`a \newline b`])('keeps native row spacing and break syntax: %s', source => {
    expect(renderEquation(source, true).svg).toBe(renderEquation(`\\begin{gathered}${source}\\end{gathered}`, true).svg);
  });
  it('accepts outer math delimiters and a trailing comment', () => {
    const result = renderEquation(String.raw`$$a \\ b % keep this comment$$`, true);
    expect(result.svg.match(/data-mml-node="mtr"/g)).toHaveLength(2);
  });
  it.each([
    String.raw`\begin{aligned}a &= b \\ c &= d\end{aligned}`,
    String.raw`\begin{pmatrix}a & b \\ c & d\end{pmatrix}`,
    String.raw`\frac{\begin{matrix}a \\ b\end{matrix}}{c}`,
    String.raw`\left(\begin{matrix}a \\ b\end{matrix}\right)`,
  ])('does not add a table around existing nested layouts: %s', source => {
    expect(renderEquation(source, true).svg.match(/data-mml-node="mtable"/g)).toHaveLength(1);
  });
  it('ignores comments and escaped backslashes when detecting breaks', () => {
    expect(renderEquation('a % \\\\ ignored', true).svg).not.toContain('data-mml-node="mtable"');
    expect(renderEquation(String.raw`\text{a \\ b}`, true).svg).not.toContain('data-mml-node="mtable"');
    expect(renderEquation(String.raw`\backslash\backslash`, true).svg).not.toContain('data-mml-node="mtable"');
    expect(renderEquation('a\nb', true).svg).toBe(renderEquation('a b', true).svg);
  });
  it.each([true, false])('preserves math style across rows (display: %s)', display => {
    const source = String.raw`\sum_{i=0}^n i \\ \frac{a}{b}`;
    const environment = display ? 'gathered' : 'matrix';
    expect(renderEquation(source, display).svg).toBe(renderEquation(`\\begin{${environment}}${source}\\end{${environment}}`, display).svg);
  });
  it('recognizes a break after escaped braces and comments', () => {
    const source = String.raw`\{a\} % \begin{matrix} { \left(
\\ b`;
    expect(renderEquation(source, true).svg.match(/data-mml-node="mtr"/g)).toHaveLength(2);
  });
  it('keeps nested rows separate from outer rows', () => {
    const source = String.raw`\begin{pmatrix}a \\ b\end{pmatrix} \\ c`;
    const result = renderEquation(source, true);
    expect(result.svg.match(/data-mml-node="mtable"/g)).toHaveLength(2);
    expect(result.svg.match(/data-mml-node="mtr"/g)).toHaveLength(4);
  });
  it('also lays out incomplete multiline previews without modifying their source', () => {
    const source = String.raw`a = b \\ \frac{c}{`;
    const result = renderPreview(source, true);
    expect(result.svg.match(/data-mml-node="mtr"/g)).toHaveLength(2);
    expect(result.source).toBe(source);
    expect(result.completed).toBe(source + '}');
  });
});

describe('incomplete equation previews', () => {
  const example = '\\varphi = \\arg{(z)} = \\arctan{\\left( \\frac{X}{R}';
  it('closes braces, \\left delimiters, and environments in the right order', () => {
    expect(completeIncompleteSource(example)).toBe(`${example}\\right)}`);
    expect(completeIncompleteSource('\\frac{a}{')).toBe('\\frac{a}{}');
    expect(completeIncompleteSource('\\left( x')).toBe('\\left( x\\right)');
    expect(completeIncompleteSource('\\left\\{ x')).toBe('\\left\\{ x\\right\\}');
    expect(completeIncompleteSource('\\left\\langle x')).toBe('\\left\\langle x\\right\\rangle');
    expect(completeIncompleteSource('\\left( \\frac{a}{b')).toBe('\\left( \\frac{a}{b}\\right)');
    expect(completeIncompleteSource('\\arctan{\\left( \\frac{X}{R')).toBe('\\arctan{\\left( \\frac{X}{R}\\right)}');
    expect(completeIncompleteSource('\\begin{pmatrix}a & b')).toBe('\\begin{pmatrix}a & b\\end{pmatrix}');
    const lineBreak = '\\\\';
    expect(completeIncompleteSource(`\\begin{aligned} a &= b ${lineBreak}`)).toBe(`\\begin{aligned} a &= b ${lineBreak}\\end{aligned}`);
    expect(completeIncompleteSource('\\frac{\\begin{matrix}a')).toBe('\\frac{\\begin{matrix}a\\end{matrix}}');
    expect(completeIncompleteSource('x^')).toBe('x^{}');
  });
  it('leaves complete input and comments alone', () => {
    expect(completeIncompleteSource('\\frac{a}{b}')).toBeUndefined();
    expect(completeIncompleteSource('\\left( x \\right)')).toBeUndefined();
    expect(completeIncompleteSource('\\begin{matrix}a\\end{matrix}')).toBeUndefined();
    expect(completeIncompleteSource('a % }')).toBeUndefined();
    expect(completeIncompleteSource('\\text{100\\%}')).toBeUndefined();
  });
  it('renders the example with the completions but keeps the original source', () => {
    const result = renderPreview(example, true);
    expect(result.source).toBe(example);
    expect(result.completed).toBe(`${example}\\right)}`);
    expect(result.svg).toContain('<path');
    expect(result.svg).not.toContain('data-mml-node="merror"');
    expect(result.viewBox[2]).toBeGreaterThan(0);
    expect(result.viewBox[3]).toBeGreaterThan(0);
  });
  it('still reports syntax errors that completion cannot fix', () => {
    expect(() => renderPreview('\\notarealcommand{x}', true)).toThrow(/Undefined control sequence/);
    expect(() => renderPreview('\\frac{a}{b}}', true)).toThrow();
    expect(() => renderPreview('\\begin{pmatrix}a\\end{aligned}', true)).toThrow();
  });
  it('leaves the strict renderer unchanged', () => {
    expect(() => renderEquation(example, true)).toThrow();
  });
});

describe('standalone SVG export', () => {
  const equation = renderEquation('\\frac{a}{b} + \\sqrt{x}', true);
  const appearance = { ink: '#ffffff', background: 'transparent', fontSize: 32, padding: 16, scale: 2 };
  it('uses vector paths, explicit ink, and no external resources', () => {
    const svg = buildSvg(equation, appearance);
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
    expect(doc.querySelector('parsererror')).toBeNull();
    expect(doc.documentElement.getAttribute('color')).toBe('#ffffff');
    expect(doc.querySelectorAll('path').length).toBeGreaterThan(0);
    expect(doc.querySelectorAll('image, use, script, foreignObject').length).toBe(0);
    expect(svg).not.toContain('currentColor');
    expect(doc.documentElement.querySelector(':scope > rect')).toBeNull();
    expect(doc.querySelector('title')?.textContent).toBe(equation.source);
  });
  it('includes an explicit black background when requested', () => {
    const svg = buildSvg(equation, { ...appearance, background: '#000000' });
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
    expect(doc.documentElement.querySelector(':scope > rect')?.getAttribute('fill')).toBe('#000000');
  });
  it('adds symmetric padding and scales with the requested font size', () => {
    const a = dimensions(equation, { ...appearance, padding: 0 });
    const b = dimensions(equation, { ...appearance, padding: 10 });
    expect(b.width - a.width).toBe(20);
    expect(b.height - a.height).toBe(20);
    const doubled = dimensions(equation, { ...appearance, padding: 0, fontSize: 64 });
    expect(Math.abs(doubled.width - a.width * 2)).toBeLessThanOrEqual(1);
  });
  it('escapes source text in the title', () => {
    const svg = buildSvg({ ...equation, source: '</title><script>alert(1)</script>' }, appearance);
    expect(new DOMParser().parseFromString(svg, 'image/svg+xml').querySelector('script')).toBeNull();
  });
});
