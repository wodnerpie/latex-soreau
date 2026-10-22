import { SVG } from 'mathjax-full/js/output/svg.js';

/** MathJax's DOM-free adaptor guesses 0.6em for every system-font glyph. */
export class MeasuredSVG<N, T, D> extends SVG<N, T, D> {
  private context = typeof OffscreenCanvas === 'undefined'
    ? null : new OffscreenCanvas(1, 1).getContext('2d');

  override measureTextNode(text: N) {
    const context = this.context;
    if (!context) return super.measureTextNode(text);

    const adaptor = this.adaptor;
    // Match the SVG text exactly, including bold/italic and explicit fonts used
    // by \\unicode. Font sizes are in SVG units (1000 units per equation em).
    const style = (name: string, fallback: string) =>
      adaptor.getStyle(text, name) || adaptor.getAttribute(text, name) || fallback;
    const size = style('font-size', '1000px');
    const family = style('font-family', 'serif');
    context.font = `${style('font-style', 'normal')} ${style('font-weight', 'normal')} ${size} ${family}`;
    const metrics = context.measureText(adaptor.textContent(text));
    return {
      w: metrics.width / 1000,
      h: Math.max(0, metrics.actualBoundingBoxAscent) / 1000,
      d: Math.max(0, metrics.actualBoundingBoxDescent) / 1000,
    };
  }
}
