import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

interface EditorBridge {
  getValue(): string;
  setValue(value: string): void;
  getSelectionText(): string;
  focus(): void;
}
type EditorWindow = Window & { __latexEditor?: EditorBridge };

async function setSource(page: Page, value: string) {
  await page.evaluate(v => {
    const editor = (window as unknown as EditorWindow).__latexEditor!;
    editor.setValue(v);
    editor.focus();
  }, value);
}
async function getValue(page: Page) {
  return page.evaluate(() => (window as unknown as EditorWindow).__latexEditor!.getValue());
}
async function getSelectionText(page: Page) {
  return page.evaluate(() => (window as unknown as EditorWindow).__latexEditor!.getSelectionText());
}
async function ready(page: Page) {
  await page.waitForFunction(() => !!(window as unknown as EditorWindow).__latexEditor, undefined, { timeout: 20000 });
  await expect(page.locator('#render-status')).toHaveText('Up to date', { timeout: 15000 });
  await expect(page.locator('#preview > svg')).toBeVisible();
}
async function pixelAt(page: Page, point: { x: number; y: number }) {
  const shot = await page.screenshot();
  return page.evaluate(async ({ data, point }) => {
    const image = new Image();
    image.src = `data:image/png;base64,${data}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext('2d')!;
    context.drawImage(image, 0, 0);
    return Array.from(context.getImageData(Math.floor(point.x), Math.floor(point.y), 1, 1).data);
  }, { data: shot.toString('base64'), point });
}
test.beforeEach(async ({ page }) => { await page.goto('/'); await ready(page); });

async function openMenu(page: Page, id: string) {
  if (await page.locator(`${id}[open]`).count()) return;
  if (await page.locator('details.menu[open]').count()) await page.keyboard.press('Escape');
  await page.locator(`${id} > summary`).click();
}
async function sourceAction(page: Page, id: string) {
  await openMenu(page, '#source-actions');
  await page.locator(id).click();
}

test('keeps secondary controls hidden until their menus are opened', async ({ page }) => {
  for (const id of ['#category', '#examples', '#ink-preset', '#display', '#scale', '#filename', '#theme', '#save-draft', '#clear']) {
    await expect(page.locator(id)).toBeHidden();
  }
  await expect(page.locator('#format')).toBeVisible();
  await expect(page.locator('#download')).toBeVisible();
  await expect(page.locator('#copy-image')).toBeVisible();
  await expect(page.locator('#copy-image')).toBeEnabled();
  await openMenu(page, '#insert-tools');
  await expect(page.locator('#category')).toBeVisible();
  await page.locator('#preferences > summary').click();
  await expect(page.locator('#category')).toBeHidden();
  await expect(page.locator('#theme')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#theme')).toBeHidden();
  await expect(page.locator('#preferences > summary')).toBeFocused();
  await openMenu(page, '#appearance-options');
  await page.getByRole('heading', { name: 'LaTeX equation editor' }).click();
  await expect(page.locator('#ink-preset')).toBeHidden();
});

test('keeps the last good equation on syntax errors, then recovers', async ({ page }) => {
  const svg = await page.locator('#preview').innerHTML();
  await setSource(page, '\\notarealcommand{x}');
  await expect(page.locator('#render-status')).toContainText('Last valid preview');
  await expect(page.locator('#preview')).toHaveJSProperty('innerHTML', svg);
  await expect(page.locator('#render-error')).toBeVisible();
  const height = await page.locator('#render-error').evaluate(el => el.getBoundingClientRect().height);
  expect(height).toBeLessThanOrEqual(64);
  await expect(page.getByRole('button', { name: 'Download SVG', exact: true })).toBeEnabled();
  await setSource(page, 'e^{i\\pi} + 1 = 0');
  await ready(page);
  await expect(page.locator('#render-error')).toBeHidden();
});

test('previews an incomplete equation by filling in its missing closers', async ({ page }) => {
  const source = '\\varphi = \\arg{(z)} = \\arctan{\\left( \\frac{X}{R}';
  await setSource(page, source);
  await expect(page.locator('#render-status')).toHaveText('Incomplete equation (auto-closed for preview)');
  await expect(page.locator('#render-error')).toBeHidden();
  await expect(page.locator('#preview > svg')).toBeVisible();
  expect(await page.locator('#preview svg path').count()).toBeGreaterThan(0);
  expect(await getValue(page)).toBe(source);
  await expect(page.locator('#export-note')).toContainText('filled in missing closers');

  const downloadPromise = page.waitForEvent('download');
  await page.locator('#download').click();
  const bytes = await readFile((await (await downloadPromise).path())!);
  expect(bytes.toString()).toContain('<svg');
  expect(bytes.toString()).toContain('<path');
  await expect(page.locator('#notice')).toHaveText('Downloaded the auto-completed preview.');
});

test('renders bare line breaks in the preview and SVG export while keeping TeX unchanged', async ({ page }) => {
  const source = String.raw`a = b \\ c = d \\ e = f`;
  await setSource(page, source);
  await ready(page);
  const rows = page.locator('#preview svg [data-mml-node="mtr"]');
  await expect(rows).toHaveCount(3);
  const boxes = await rows.evaluateAll(elements => elements.map(el => el.getBoundingClientRect().toJSON()));
  expect(boxes[1].top).toBeGreaterThan(boxes[0].bottom);
  expect(boxes[2].top).toBeGreaterThan(boxes[1].bottom);
  expect(await getValue(page)).toBe(source);
  await expect(page.locator('#render-error')).toBeHidden();

  for (const format of ['svg', 'tex']) {
    await page.locator('#format').selectOption(format);
    const downloadPromise = page.waitForEvent('download');
    await page.locator('#download').click();
    const bytes = await readFile((await (await downloadPromise).path())!);
    if (format === 'svg') expect(bytes.toString().match(/data-mml-node="mtr"/g)).toHaveLength(3);
    else expect(bytes.toString()).toBe(source);
  }
});

test('exports all formats, including transparent PNG and opaque JPG', async ({ page }) => {
  for (const format of ['svg', 'png', 'jpg', 'webp', 'tex']) {
    await page.locator('#format').selectOption(format);
    const downloadPromise = page.waitForEvent('download');
    await page.locator('#download').click();
    const downloaded = await downloadPromise;
    expect(downloaded.suggestedFilename()).toBe(`equation.${format}`);
    const path = await downloaded.path();
    const bytes = await readFile(path!);
    expect(bytes.length).toBeGreaterThan(20);
    if (format === 'svg') { expect(bytes.toString()).toContain('<svg'); expect(bytes.toString()).toContain('<path'); }
    if (format === 'tex') expect(bytes.toString()).toContain('\\frac');
    if (format === 'png' || format === 'jpg' || format === 'webp') {
      const pixels = await page.evaluate(async ({ data, type }) => {
        const image = new Image();
        image.src = `data:image/${type === 'jpg' ? 'jpeg' : type};base64,${data}`;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = image.width; canvas.height = image.height;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(image, 0, 0);
        const pixels = ctx.getImageData(0, 0, image.width, image.height).data;
        let visibleInk = 0;
        for (let i = 0; i < pixels.length; i += 4) {
          if (pixels[i + 3] > 200 && pixels[i] < 100 && pixels[i + 1] < 100 && pixels[i + 2] < 100) visibleInk++;
        }
        return { width: image.width, corner: Array.from(pixels.slice(0, 4)), visibleInk };
      }, { data: bytes.toString('base64'), type: format });
      expect(pixels.width).toBeGreaterThan(50);
      expect(pixels.visibleInk).toBeGreaterThan(20);
      if (format === 'jpg') expect(pixels.corner).toEqual([255, 255, 255, 255]);
      else expect(pixels.corner[3]).toBe(0);
    }
  }
});

test('copies a PNG with the current appearance and image scale', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openMenu(page, '#appearance-options');
  await page.locator('#ink-preset').selectOption('#ffffff');
  await page.locator('#background-preset').selectOption('#000000');
  await page.locator('#font-size').fill('40');
  await page.locator('#padding').fill('20');
  await openMenu(page, '#export-options');
  await page.locator('#scale').selectOption('4');
  await expect(page.locator('#preview svg')).toHaveAttribute('color', '#ffffff');
  const previewSize = await page.locator('#preview svg').evaluate(svg => ({
    width: Number(svg.getAttribute('width')),
    height: Number(svg.getAttribute('height')),
  }));
  await page.locator('#copy-image').click();
  await expect(page.locator('#notice')).toHaveText('Image copied as PNG.');
  const png = await page.evaluate(async () => {
    for (const item of await navigator.clipboard.read()) {
      if (!item.types.includes('image/png')) continue;
      const bytes = new Uint8Array(await (await item.getType('image/png')).arrayBuffer());
      let binary = '';
      for (const byte of bytes) binary += String.fromCharCode(byte);
      return btoa(binary);
    }
    return null;
  });
  expect(png).not.toBeNull();
  const copied = await page.evaluate(async data => {
    const image = new Image();
    image.src = `data:image/png;base64,${data}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(image, 0, 0);
    const pixels = ctx.getImageData(0, 0, image.width, image.height).data;
    let lightInk = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i + 3] > 200 && pixels[i] > 240 && pixels[i + 1] > 240 && pixels[i + 2] > 240) lightInk++;
    }
    return { width: image.width, height: image.height, corner: Array.from(pixels.slice(0, 4)), lightInk };
  }, png!);
  expect(copied.width).toBe(Math.ceil(previewSize.width * 4));
  expect(copied.height).toBe(Math.ceil(previewSize.height * 4));
  expect(copied.corner).toEqual([0, 0, 0, 255]);
  expect(copied.lightInk).toBeGreaterThan(20);
});

test('supports white equations, black backgrounds, scale, and padding', async ({ page }) => {
  await openMenu(page, '#appearance-options');
  await page.locator('#ink-preset').selectOption('#ffffff');
  await expect(page.locator('#preview-stage')).toHaveClass(/checker-dark/);
  await page.locator('#background-preset').selectOption('#000000');
  await page.locator('#font-size').fill('48');
  await page.locator('#padding').fill('24');
  await expect(page.locator('#preview svg')).toHaveAttribute('color', '#ffffff');
  await expect(page.locator('#preview svg > rect').first()).toHaveAttribute('fill', '#000000');
  await page.locator('#format').selectOption('png');
  await openMenu(page, '#export-options');
  await page.locator('#scale').selectOption('4');
  await expect(page.locator('#export-size')).toContainText('px');
  const promise = page.waitForEvent('download');
  await page.locator('#download').click();
  const bytes = await readFile((await (await promise).path())!);
  const corner = await page.evaluate(async data => {
    const image = new Image(); image.src = `data:image/png;base64,${data}`; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    const ctx = canvas.getContext('2d')!; ctx.drawImage(image, 0, 0);
    return Array.from(ctx.getImageData(0, 0, 1, 1).data);
  }, bytes.toString('base64'));
  expect(corner).toEqual([0, 0, 0, 255]);
});

test('selects all, highlights the selection, and replaces it by typing', async ({ page }) => {
  await setSource(page, 'x + y = z');
  await ready(page);
  await page.keyboard.press('Control+a');
  expect(await getSelectionText(page)).toBe('x + y = z');
  const line = (await page.locator('#editor .view-line').first().boundingBox())!;
  const point = { x: line.x + 24, y: line.y + line.height / 2 };
  const selected = await pixelAt(page, point);
  await page.keyboard.press('ArrowRight');
  const unselected = await pixelAt(page, point);
  expect(selected).not.toEqual(unselected);
  await page.keyboard.press('Control+a');
  await page.keyboard.type('a=b');
  expect(await getValue(page)).toBe('a=b');
});

test('selects text by dragging and double-clicking', async ({ page }) => {
  await setSource(page, 'x + y = z');
  const lines = (await page.locator('#editor .view-lines').boundingBox())!;
  const y = lines.y + 12;
  await page.mouse.move(lines.x + 4, y);
  await page.mouse.down();
  await page.mouse.move(lines.x + 70, y, { steps: 12 });
  await page.mouse.up();
  const dragged = await getSelectionText(page);
  expect(dragged.length).toBeGreaterThan(0);
  expect('x + y = z'.includes(dragged)).toBe(true);
  await page.mouse.dblclick(lines.x + 5, y);
  expect(await getSelectionText(page)).toBe('x');
});

test('Tab accepts a snippet and walks through its fields', async ({ page }) => {
  await setSource(page, '');
  await page.keyboard.type('\\fra');
  await expect(page.locator('.suggest-widget.visible')).toBeVisible();
  await page.keyboard.press('Tab');
  await expect.poll(() => getValue(page)).toBe('\\frac{a}{b}');
  expect(await getSelectionText(page)).toBe('a');
  await page.keyboard.press('Tab');
  expect(await getSelectionText(page)).toBe('b');
});

test('Ctrl+Space lists commands, including after a bare word', async ({ page }) => {
  await setSource(page, '\\sq');
  await page.keyboard.press('Control+Space');
  await expect(page.locator('.suggest-widget.visible')).toBeVisible();
  await expect(page.locator('.suggest-widget.visible .monaco-list-row', { hasText: '\\sqrt' }).first()).toBeVisible();
  await page.keyboard.press('Enter');
  await expect.poll(() => getValue(page)).toBe('\\sqrt{x}');
  await setSource(page, 'frac');
  await page.keyboard.press('Control+Space');
  await expect(page.locator('.suggest-widget.visible .monaco-list-row.focused')).toContainText('\\frac');
  await page.keyboard.press('Enter');
  await expect.poll(() => getValue(page)).toBe('\\frac{a}{b}');
});

test('inserts templates and accepts autocomplete snippets', async ({ page }) => {
  await sourceAction(page, '#clear');
  await openMenu(page, '#insert-tools');
  await page.getByRole('button', { name: 'Fraction', exact: true }).click();
  await ready(page);
  await expect.poll(() => getValue(page)).toBe('\\frac{a}{b}');
  await expect(page.locator('#category')).toBeHidden();
  await setSource(page, '\\sq');
  await page.keyboard.press('Control+Space');
  await expect(page.locator('.suggest-widget.visible .monaco-list-row', { hasText: '\\sqrt' }).first()).toBeVisible();
  await page.keyboard.press('Enter');
  await ready(page);
  await expect.poll(() => getValue(page)).toBe('\\sqrt{x}');
});

test('autosaves source, can disable saving, and supports undo clear', async ({ page }) => {
  await setSource(page, 'a^2+b^2=c^2');
  await ready(page);
  await expect(page.locator('#save-status')).toHaveText('Draft saved locally');
  await page.reload(); await ready(page);
  await expect.poll(() => getValue(page)).toBe('a^2+b^2=c^2');
  await sourceAction(page, '#clear');
  await expect(page.locator('#preview svg')).toHaveCount(0);
  await page.locator('#editor .monaco-editor .view-lines').click();
  await page.keyboard.press('Control+z');
  await ready(page);
  await expect.poll(() => getValue(page)).toBe('a^2+b^2=c^2');
  await openMenu(page, '#preferences');
  await page.locator('#save-draft').uncheck();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('latex-soreau-v1')!));
  expect(saved.source).toBeUndefined();
});

test('loads examples, handles recursive macros, and remains usable', async ({ page }) => {
  for (const example of ['Matrix', 'Aligned equations', 'Piecewise function', 'Physics']) {
    await openMenu(page, '#insert-tools');
    await page.locator('#examples').selectOption(example);
    await page.locator('#load-example').click();
    await ready(page);
  }
  await setSource(page, '\\def\\x{\\x}\\x');
  await expect(page.locator('#render-error')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('#preview svg')).toBeVisible();
  await setSource(page, 'x=1'); await ready(page);
});

test('share links restore unicode source and appearance without network uploads', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await setSource(page, '\\text{énergie} = mc^2'); await ready(page);
  await openMenu(page, '#appearance-options');
  await page.locator('#font-size').fill('40');
  await sourceAction(page, '#share');
  const url = await page.evaluate(() => navigator.clipboard.readText());
  expect(url).toContain('#equation=');
  const freshContext = await page.context().browser()!.newContext();
  const fresh = await freshContext.newPage();
  await fresh.goto(url); await ready(fresh);
  await expect.poll(() => getValue(fresh)).toBe('\\text{énergie} = mc^2');
  await openMenu(fresh, '#appearance-options');
  await expect(fresh.locator('#font-size')).toHaveValue('40');
  await freshContext.close();
});

test('spaces accented characters using their actual glyph widths in preview and exports', async ({ page }) => {
  for (const command of ['text', 'textbf', 'textit', 'textsf', 'texttt']) {
    const source = `\\${command}{éxèxêxëxàxâxùxûxüxôxöxïxîxçxÉxÙxœx}`;
    await setSource(page, source);
    await ready(page);
    const checkSpacing = () => {
      const svg = document.querySelector('#preview > svg') as SVGSVGElement;
      return Array.from(svg.querySelectorAll('text')).map(text => {
        const next = text.nextElementSibling as SVGGraphicsElement;
        const start = text.transform.baseVal.consolidate()!.matrix.e;
        const end = next.transform.baseVal.consolidate()!.matrix.e;
        return { char: text.textContent, error: Math.abs(end - start - text.getComputedTextLength()) };
      });
    };
    const measurements = await page.evaluate(checkSpacing);
    expect(measurements.length).toBeGreaterThan(10);
    for (const { char, error } of measurements) {
      expect(error, `${command}: spacing after ${char}`).toBeLessThan(1);
    }

    // SVG downloads must preserve the same measured advances, not just a
    // browser-only adjustment to the on-screen preview.
    const promise = page.waitForEvent('download');
    await page.locator('#download').click();
    const bytes = await readFile((await (await promise).path())!);
    await page.locator('#preview').evaluate((preview, svg) => { preview.innerHTML = svg; }, bytes.toString());
    for (const { char, error } of await page.evaluate(checkSpacing)) {
      expect(error, `${command}: exported spacing after ${char}`).toBeLessThan(1);
    }
    expect(await getValue(page)).toBe(source);
  }
});

test('uses the self-hosted JetBrains Mono font in the editor', async ({ page }) => {
  const loaded = await page.evaluate(async () => {
    await document.fonts.load('15px "JetBrains Mono"');
    return document.fonts.check('15px "JetBrains Mono"');
  });
  expect(loaded).toBe(true);
  const family = await page.evaluate(() => getComputedStyle(document.querySelector('#editor .monaco-editor .view-lines')!).fontFamily);
  expect(family).toContain('JetBrains Mono');
});

test('clicks land on the character under the pointer even when the font loads late', async ({ page }) => {
  // Monaco caches glyph metrics when it is created; a font that swaps in later
  // used to leave every click sitting to the left of the intended character.
  await page.route('**/*.woff2', async route => {
    await new Promise(resolve => setTimeout(resolve, 1200));
    await route.continue();
  });
  await page.goto('/');
  await page.waitForFunction(() => !!(window as unknown as EditorWindow).__latexEditor, undefined, { timeout: 20000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(200);
  const digits = '0123456789012345678901234567890123456789';
  await setSource(page, digits);
  const geometry = await page.evaluate(() => {
    const line = document.querySelector('#editor .view-line')!;
    const span = line.querySelector('span') ?? line;
    const lineBox = line.getBoundingClientRect();
    const spanBox = span.getBoundingClientRect();
    return {
      textOriginX: spanBox.left,
      advance: spanBox.width / (line.textContent ?? '').length,
      lineTop: lineBox.top,
      lineHeight: lineBox.height,
    };
  });
  const loaded = await page.evaluate(async () => { await document.fonts.load('15px "JetBrains Mono"'); return document.fonts.check('15px "JetBrains Mono"'); });
  expect(loaded).toBe(true);
  for (const index of [10, 20, 30]) {
    await setSource(page, digits);
    await page.mouse.click(geometry.textOriginX + (index + 0.5) * geometry.advance, geometry.lineTop + geometry.lineHeight / 2);
    await page.keyboard.type('Z');
    const insertedAt = (await getValue(page)).indexOf('Z');
    expect(Math.abs(insertedAt - index), `click on character ${index}`).toBeLessThanOrEqual(1);
  }
});

test('preview aligns to whole device pixels', async ({ page }) => {
  const offset = async () => page.evaluate(() => {
    const svg = document.querySelector('#preview > svg') as SVGSVGElement;
    const rect = svg.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    return {
      x: Math.abs(rect.left * ratio - Math.round(rect.left * ratio)),
      y: Math.abs(rect.top * ratio - Math.round(rect.top * ratio)),
    };
  });
  await expect.poll(async () => (await offset()).y).toBeLessThan(0.05);
  expect((await offset()).x).toBeLessThan(0.05);
  await openMenu(page, '#appearance-options');
  await page.locator('#font-size').fill('61');
  await expect.poll(async () => (await offset()).y, { timeout: 10000 }).toBeLessThan(0.05);
  expect((await offset()).x).toBeLessThan(0.05);
});

test('mobile layouts and both themes have no page overflow', async ({ page }) => {
  for (const width of [320, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 850 });
    for (const theme of ['light', 'dark']) {
      await openMenu(page, '#preferences');
      await page.locator('#theme').selectOption(theme);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      expect(overflow, `${width}px ${theme}`).toBe(false);
      for (const id of ['#insert-tools', '#source-actions', '#appearance-options', '#export-options']) {
        await openMenu(page, id);
        expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), `${id} at ${width}px ${theme}`).toBe(false);
      }
    }
  }
});

test('empty source disables downloads and unknown commands do not erase preview', async ({ page }) => {
  await setSource(page, '\\unknowncommand{x}');
  await expect(page.locator('#render-error')).toContainText('Undefined control sequence');
  await expect(page.locator('#preview svg')).toBeVisible();
  await sourceAction(page, '#clear');
  await expect(page.locator('#download')).toBeDisabled();
  await expect(page.locator('#copy-image')).toBeDisabled();
  await expect(page.locator('#preview svg')).toHaveCount(0);
});
