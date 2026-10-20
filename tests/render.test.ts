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
