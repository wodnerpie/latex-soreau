import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function edit(page: Page, value: string) {
  const editor = page.getByRole('textbox', { name: 'LaTeX source' });
  await editor.fill(value);
}
async function ready(page: Page) {
  await expect(page.locator('#render-status')).toHaveText('Up to date', { timeout: 15000 });
  await expect(page.locator('#preview > svg')).toBeVisible();
}
test.beforeEach(async ({ page }) => { await page.goto('/'); await ready(page); });

test('keeps the last good equation on syntax errors, then recovers', async ({ page }) => {
  const svg = await page.locator('#preview').innerHTML();
  await edit(page, '\\frac{a}{');
  await expect(page.locator('#render-status')).toContainText('Last valid preview');
  await expect(page.locator('#preview')).toHaveJSProperty('innerHTML', svg);
  await expect(page.locator('#render-error')).toBeVisible();
  const height = await page.locator('#render-error').evaluate(el => el.getBoundingClientRect().height);
  expect(height).toBeLessThanOrEqual(64);
  await expect(page.getByRole('button', { name: 'Download SVG', exact: true })).toBeEnabled();
  await edit(page, 'e^{i\\pi} + 1 = 0');
  await ready(page);
  await expect(page.locator('#render-error')).toBeHidden();
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

test('supports white equations, black backgrounds, scale, and padding', async ({ page }) => {
  await page.locator('#ink-preset').selectOption('#ffffff');
  await expect(page.locator('#preview-stage')).toHaveClass(/checker-dark/);
  await page.locator('#background-preset').selectOption('#000000');
  await page.locator('#font-size').fill('48');
  await page.locator('#padding').fill('24');
  await expect(page.locator('#preview svg')).toHaveAttribute('color', '#ffffff');
  await expect(page.locator('#preview svg > rect').first()).toHaveAttribute('fill', '#000000');
  await page.locator('#format').selectOption('png');
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

test('inserts templates and accepts autocomplete snippets', async ({ page }) => {
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await page.getByRole('button', { name: 'Fraction', exact: true }).click();
  await ready(page);
  await expect(page.locator('.cm-content')).toContainText('\\frac{a}{b}');
  await edit(page, '\\sq');
  await page.locator('.cm-content').press('Control+Space');
  await expect(page.getByRole('option', { name: /\\sqrt/ })).toBeVisible();
  await page.locator('.cm-content').press('Enter');
  await ready(page);
  await expect(page.locator('.cm-content')).toContainText('\\sqrt{x}');
});

test('autosaves source, can disable saving, and supports undo clear', async ({ page }) => {
  await edit(page, 'a^2+b^2=c^2');
  await ready(page);
  await expect(page.locator('#save-status')).toHaveText('Draft saved locally');
  await page.reload(); await ready(page);
  await expect(page.locator('.cm-content')).toContainText('a^2+b^2=c^2');
  await page.locator('#clear').click();
  await expect(page.locator('#preview svg')).toHaveCount(0);
  await page.locator('.cm-content').press('Control+z');
  await ready(page);
  await page.locator('#save-draft').uncheck();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('latex-soreau-v1')!));
  expect(saved.source).toBeUndefined();
});

test('loads examples, handles recursive macros, and remains usable', async ({ page }) => {
  for (const example of ['Matrix', 'Aligned equations', 'Piecewise function', 'Physics']) {
    await page.locator('#examples').selectOption(example);
    await page.locator('#load-example').click();
    await ready(page);
  }
  await edit(page, '\\def\\x{\\x}\\x');
  await expect(page.locator('#render-error')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('#preview svg')).toBeVisible();
  await edit(page, 'x=1'); await ready(page);
});

test('share links restore unicode source and appearance without network uploads', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await edit(page, '\\text{énergie} = mc^2'); await ready(page);
  await page.locator('#font-size').fill('40');
  await page.locator('#share').click();
  const url = await page.evaluate(() => navigator.clipboard.readText());
  expect(url).toContain('#equation=');
  const freshContext = await page.context().browser()!.newContext();
  const fresh = await freshContext.newPage();
  await fresh.goto(url); await ready(fresh);
  await expect(fresh.locator('.cm-content')).toContainText('énergie');
  await expect(fresh.locator('#font-size')).toHaveValue('40');
  await freshContext.close();
});

test('mobile layouts and both themes have no page overflow', async ({ page }) => {
  for (const width of [320, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 850 });
    for (const theme of ['light', 'dark']) {
      await page.locator('#theme').selectOption(theme);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      expect(overflow, `${width}px ${theme}`).toBe(false);
    }
  }
});

test('empty source disables downloads and unknown commands do not erase preview', async ({ page }) => {
  await edit(page, '\\unknowncommand{x}');
  await expect(page.locator('#render-error')).toContainText('Undefined control sequence');
  await expect(page.locator('#preview svg')).toBeVisible();
  await page.locator('#clear').click();
  await expect(page.locator('#download')).toBeDisabled();
  await expect(page.locator('#preview svg')).toHaveCount(0);
});
