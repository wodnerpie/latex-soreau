import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderEquation } from '../src/render';

afterEach(() => vi.unstubAllGlobals());

describe('system-font glyph measurements', () => {
  function mockCanvas() {
    const context = {
      font: '',
      measureText: vi.fn(() => ({ width: 375, actualBoundingBoxAscent: 680, actualBoundingBoxDescent: 12 })),
    };
    vi.stubGlobal('OffscreenCanvas', class {
      getContext() { return context; }
    });
    return context;
  }

  it.each(['é', 'ù', 'ç', 'œ', 'É'])('uses the measured advance for %s, not the 600-unit guess', char => {
    const context = mockCanvas();
    const equation = renderEquation(`\\text{${char}x}`, true);
    const svg = new DOMParser().parseFromString(equation.svg, 'image/svg+xml');
    expect(context.measureText).toHaveBeenCalledWith(char);
    expect(context.font).toBe('normal normal 884px serif');
    expect(svg.querySelector('text + path')?.getAttribute('transform')).toBe('translate(375,0)');
    expect(equation.source).toBe(`\\text{${char}x}`);
  });

  it.each([
    ['\\textbf{éx}', 'normal bold 884px serif'],
    ['\\textit{éx}', 'italic normal 884px serif'],
    ['\\textsf{éx}', 'normal normal 884px sans-serif'],
    ['\\texttt{éx}', 'normal normal 884px monospace'],
  ])('measures the SVG font variant: %s', (source, font) => {
    const context = mockCanvas();
    renderEquation(source, true);
    expect(context.font).toBe(font);
  });

  it('uses measured widths for accented math variables and their scripts', () => {
    mockCanvas();
    const plain = new DOMParser().parseFromString(renderEquation('éx', true).svg, 'image/svg+xml');
    expect(plain.querySelector('[data-mml-node="mi"] + g')?.getAttribute('transform')).toBe('translate(375,0)');
    const scripted = new DOMParser().parseFromString(renderEquation('é^2+x', true).svg, 'image/svg+xml');
    const script = scripted.querySelector('[data-mml-node="msup"] > [data-mml-node="mn"]');
    const offset = Number(script?.getAttribute('transform')?.match(/translate\(([^,]+)/)?.[1]);
    expect(offset).toBeGreaterThanOrEqual(375);
    expect(offset).toBeLessThan(600);
  });

  it('keeps the renderer usable when canvas measurement is unavailable', () => {
    vi.stubGlobal('OffscreenCanvas', undefined);
    expect(renderEquation('\\text{éx}', true).svg).toContain('translate(600,0)');
    vi.stubGlobal('OffscreenCanvas', class { getContext() { return null; } });
    expect(renderEquation('\\text{ùx}', true).svg).toContain('translate(600,0)');
  });
});
