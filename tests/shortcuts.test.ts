import { describe, expect, it } from 'vitest';
import { isLiteralContext, keyboardMathEdit } from '../src/shortcuts';

function converted(source: string, cursor = source.length) {
  const edit = keyboardMathEdit(source, cursor);
  if (!edit) return undefined;
  const result = source.slice(0, edit.start) + edit.text + source.slice(edit.end);
  return { result, edit };
}

describe('keyboard math shortcuts', () => {
  describe('fractions', () => {
    const cases: Array<[string, string, string]> = [
      ['1/', '\\frac{1}{}', '1'],
      ['x = 1/', 'x = \\frac{1}{}', '1'],
      ['x^2/', '\\frac{x^2}{}', 'x^2'],
      ['x_{i}/', '\\frac{x_{i}}{}', 'x_{i}'],
      ['2x/', '\\frac{2x}{}', '2x'],
      ['2\\pi/', '\\frac{2\\pi}{}', '2\\pi'],
      ['\\pi^2/', '\\frac{\\pi^2}{}', '\\pi^2'],
      ['(a+b)/', '\\frac{(a+b)}{}', '(a+b)'],
      ['f(x)/', '\\frac{f(x)}{}', 'f(x)'],
      ['2(x+1)/', '\\frac{2(x+1)}{}', '2(x+1)'],
      ['(a+b)(c+d)/', '\\frac{(a+b)(c+d)}{}', '(a+b)(c+d)'],
      ['\\sin x/', '\\frac{\\sin x}{}', '\\sin x'],
      ['\\alpha\\beta/', '\\frac{\\alpha\\beta}{}', '\\alpha\\beta'],
      ['a\\times b/', 'a\\times \\frac{b}{}', 'b'],
      ['a \\le b/', 'a \\le \\frac{b}{}', 'b'],
      ['a+b/', 'a+\\frac{b}{}', 'b'],
      ['\\sqrt{x}/', '\\frac{\\sqrt{x}}{}', '\\sqrt{x}'],
      ['\\sqrt[3]{x}/', '\\frac{\\sqrt[3]{x}}{}', '\\sqrt[3]{x}'],
      ['\\frac{a}{b}/', '\\frac{\\frac{a}{b}}{}', '\\frac{a}{b}'],
      ['\\sin(x)/', '\\frac{\\sin(x)}{}', '\\sin(x)'],
      ['|x|/', '\\frac{|x|}{}', '|x|'],
      ['n!/', '\\frac{n!}{}', 'n!'],
      ['a /', '\\frac{a}{}', 'a'],
    ];
    it.each(cases)('turns %s into a fraction', (source, text, numerator) => {
      const convertedValue = converted(source);
      expect(convertedValue?.result).toBe(text);
      expect(convertedValue?.result.slice(convertedValue.edit.start, convertedValue.edit.cursor)).toBe(`\\frac{${numerator}}{`);
    });
    it('does not treat an operator with a missing operand as a numerator', () => {
      expect(converted('a\\times /')).toBeUndefined();
      expect(converted('a \\le /')).toBeUndefined();
      expect(converted('\\left\\{ x \\right\\}/')).toBeUndefined();
    });
    it('puts the cursor in the empty denominator', () => {
      const value = converted('1/');
      expect(value?.result[value.edit.cursor]).toBe('}');
      expect(value?.result.slice(0, value.edit.cursor)).toBe('\\frac{1}{');
    });
    it('starts a fraction with an empty numerator when there is nothing before the slash', () => {
      const value = converted('/');
      expect(value?.result).toBe('\\frac{}{}');
      expect(value?.result.slice(0, value.edit.cursor)).toBe('\\frac{');
    });
    it('keeps the rest of the line after the new denominator placeholder', () => {
      const value = converted('1/2', 2);
      expect(value?.result).toBe('\\frac{1}{}2');
      expect(value?.result.slice(0, value.edit.cursor)).toBe('\\frac{1}{');
    });
    it('does not turn a slash in text, a comment, or an escaped slash into a fraction', () => {
      expect(converted('\\text{a/b}', 8)).toBeUndefined();
      expect(converted('\\operatorname{a/b}', 16)).toBeUndefined();
      expect(converted('a % b/c', 6)).toBeUndefined();
      expect(converted('\\text{a {b/c} d}', 11)).toBeUndefined();
      expect(converted('a\\/b', 3)).toBeUndefined();
    });
  });

  describe('symbols', () => {
    it.each([
      ['a*', 'a\\times '],
      ['a<=', 'a\\le '],
      ['a>=', 'a\\ge '],
      ['a!=', 'a\\ne '],
      ['a->', 'a\\to '],
      ['a=>', 'a\\Rightarrow '],
      ['a...', 'a\\ldots '],
    ])('turns %s into %s', (source, result) => {
      expect(converted(source)?.result).toBe(result);
    });
    it('leaves command stars and escaped signs alone', () => {
      expect(converted('\\operatorname*')).toBeUndefined();
      expect(converted('\\tag*')).toBeUndefined();
      expect(converted('a\\\\*')).toBeUndefined();
      expect(converted('a\\*')).toBeUndefined();
      expect(converted('a\\<=')).toBeUndefined();
    });
    it('does not change symbols inside text or comments', () => {
      expect(converted('\\text{a*b}')).toBeUndefined();
      expect(converted('\\text{a<=b}')).toBeUndefined();
      expect(converted('a % b*')).toBeUndefined();
    });
  });

  describe('literal contexts', () => {
    it('recognizes text arguments, including nested groups', () => {
      expect(isLiteralContext('\\text{a}', 6)).toBe(true);
      expect(isLiteralContext('\\text{a {b}}', 10)).toBe(true);
      expect(isLiteralContext('\\text{a} x', 9)).toBe(false);
      expect(isLiteralContext('\\operatorname{foo}', 16)).toBe(true);
      expect(isLiteralContext('\\textcolor{red}{x}', 12)).toBe(true);
      expect(isLiteralContext('\\textcolor{red}{x}', 16)).toBe(false);
      expect(isLiteralContext('a % comment', 7)).toBe(true);
      expect(isLiteralContext('a \\% sign', 5)).toBe(false);
    });
  });
});
