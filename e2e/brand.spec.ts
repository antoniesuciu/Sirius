import { mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';

test('the Sirius wolf is visible and still while idle in all themes', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop');
  mkdirSync('docs/design/logos/themes', { recursive: true });
  await page.goto('/?fixtures&toastMs=600000');
  for (const theme of ['paper', 'midnight', 'night-owl', 'graphite', 'sage', 'ember']) {
    await page.getByLabel('Message Sirius').fill(`theme ${theme}`);
    await page.getByLabel('Message Sirius').press('Enter');
    await expect(page.getByRole('button', { name: 'Send' })).toBeEnabled();
    if (theme === 'paper')
      await expect(page.locator('html')).not.toHaveAttribute('data-theme', /./);
    else await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    const mark = page.locator('.sirius-head .sirius-logo');
    await expect(mark).toBeVisible();
    await expect(mark).toHaveAttribute('data-state', 'idle');
    await expect(mark).toHaveAttribute('data-running', 'false');
    // The wolf takes the theme's voice colours, so it is never left unpainted.
    const ink = await mark
      .locator('stop')
      .first()
      .evaluate((stop) => getComputedStyle(stop).stopColor);
    expect(ink).not.toBe('rgba(0, 0, 0, 0)');
    await page
      .locator('.sirius-head')
      .screenshot({ path: `docs/design/logos/themes/wolf-${theme}.png` });
  }
});

test('the list sits below Sirius and roadmap summaries stay compact', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop');
  await page.goto('/?fixtures&toastMs=600000');
  const left = page.locator('.col-3');
  await expect(left.getByRole('heading', { name: 'To remember' })).toBeVisible();
  await expect(left.getByRole('heading', { name: 'Well-being' })).toHaveCount(0);
  for (const card of await page.locator('.roadmap-card').all()) {
    expect((await card.boundingBox())!.height).toBeLessThan(150);
  }
  await expect(page.locator('h1')).toContainText('matter today.');
  await expect(page.locator('.panel-sirius')).toHaveCSS('opacity', '1');
});

test('the Orbit launcher icon has transparent corners', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop');
  await page.goto('/?fixtures&toastMs=600000');
  const alpha = await page.evaluate(async () => {
    const img = new Image();
    img.src = '/icon-192.png';
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 192;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    return [ctx.getImageData(0, 0, 1, 1).data[3], ctx.getImageData(191, 191, 1, 1).data[3]];
  });
  expect(alpha).toEqual([0, 0]);
});
