import type { RenderedEquation } from './render';

export interface Appearance {
  ink: string;
  background: string;
  fontSize: number;
  padding: number;
  scale: number;
}

export const MAX_SIDE = 16384;
export const MAX_PIXELS = 32 * 1024 * 1024;

export function dimensions(equation: RenderedEquation, options: Appearance) {
  return {
    width: Math.max(1, Math.ceil(equation.viewBox[2] / 1000 * options.fontSize + options.padding * 2)),
    height: Math.max(1, Math.ceil(equation.viewBox[3] / 1000 * options.fontSize + options.padding * 2)),
  };
}

export function buildSvg(equation: RenderedEquation, options: Appearance): string {
  const { width, height } = dimensions(equation, options);
  const [x, y, w, h] = equation.viewBox;
  // Match the rounded pixel dimensions exactly, avoiding transparent letterboxing
  // around an otherwise opaque SVG. The extra fraction of a pixel is symmetric.
  const boxWidth = width * 1000 / options.fontSize;
  const boxHeight = height * 1000 / options.fontSize;
  const left = x - (boxWidth - w) / 2;
  const top = y - (boxHeight - h) / 2;
  const doc = new DOMParser().parseFromString(equation.svg, 'image/svg+xml');
  const svg = doc.documentElement;
  svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(height));
  svg.setAttribute('viewBox', `${left} ${top} ${boxWidth} ${boxHeight}`);
  svg.setAttribute('role', 'img');
  svg.removeAttribute('style');
  // Explicit color + fill makes the self-contained SVG portable across browsers and image editors.
  svg.setAttribute('color', options.ink);
  svg.setAttribute('fill', options.ink);
  for (const element of svg.querySelectorAll('[fill="currentColor"], [stroke="currentColor"]')) {
    if (element.getAttribute('fill') === 'currentColor') element.setAttribute('fill', options.ink);
    if (element.getAttribute('stroke') === 'currentColor') element.setAttribute('stroke', options.ink);
  }
  const title = doc.createElementNS('http://www.w3.org/2000/svg', 'title');
  title.textContent = equation.source;
  svg.prepend(title);
  if (options.background !== 'transparent') {
    const rect = doc.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', String(left));
    rect.setAttribute('y', String(top));
    rect.setAttribute('width', String(boxWidth));
    rect.setAttribute('height', String(boxHeight));
    rect.setAttribute('fill', options.background);
    svg.insertBefore(rect, title.nextSibling);
  }
  return new XMLSerializer().serializeToString(svg);
}

export async function imageBlob(equation: RenderedEquation, options: Appearance, format: 'png' | 'jpg' | 'webp', quality = 0.95): Promise<Blob> {
  // JPEG cannot store transparency. Make the fallback explicit in the interface as well.
  const effective = format === 'jpg' && options.background === 'transparent'
    ? { ...options, background: '#ffffff' } : options;
  const size = dimensions(equation, effective);
  const width = Math.ceil(size.width * options.scale);
  const height = Math.ceil(size.height * options.scale);
  if (width > MAX_SIDE || height > MAX_SIDE || width * height > MAX_PIXELS) {
    throw new Error('Image too large. Reduce the font size, padding, or image scale.');
  }
  const url = URL.createObjectURL(new Blob([buildSvg(equation, effective)], { type: 'image/svg+xml' }));
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Your browser cannot export images. Try SVG instead.');
    if (effective.background !== 'transparent') {
      context.fillStyle = effective.background;
      context.fillRect(0, 0, width, height);
    }
    context.drawImage(image, 0, 0, width, height);
    const mime = format === 'jpg' ? 'image/jpeg' : `image/${format}`;
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, mime, quality));
    if (!blob || blob.type !== mime) throw new Error(`Your browser cannot export ${format.toUpperCase()}. Try PNG or SVG.`);
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
