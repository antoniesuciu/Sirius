import { readFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test('roadmap route is accessible on desktop and phone', async ({ page }, testInfo) => {
  await page.goto('/?fixtures&toastMs=600000');
  await page.locator('.node-button', { hasText: 'Real analysis' }).click();
  const route = page.getByRole('dialog');
  await expect(route.getByRole('heading', { name: 'Real analysis', exact: true })).toBeVisible();
  expect(await route.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  const result = await new AxeBuilder({ page }).include('.roadmap-dialog').analyze();
  expect(result.violations.map((v) => `${v.id}: ${v.nodes[0]?.html}`)).toEqual([]);
  await page.screenshot({ path: `docs/images/roadmap-${testInfo.project.name}.png` });
  await page.keyboard.press('Escape');
  await expect(route).toHaveCount(0);
  await page.getByRole('button', { name: 'Codex', exact: true }).click();
  await page.getByRole('button', { name: /Model:/ }).click();
  await expect(page.getByRole('option')).toHaveCount(4);
  await page.getByRole('option', { name: 'Codex 6.1 Sol Medium' }).click();
  await expect(page.getByRole('button', { name: 'Model: Codex 6.1 Sol Medium' })).toBeVisible();
});

test('logo concept gallery', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop');
  await page.route('**/__design/assets/*', (route) =>
    route.fulfill({
      path: `packages/ui/src/assets/brand/${route.request().url().split('/').at(-1)}`,
    }),
  );
  await page.route('**/__design/logos', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: readFileSync('docs/design/logos/index.html', 'utf8').replaceAll(
        '../../../packages/ui/src/assets/brand/',
        '/__design/assets/',
      ),
    }),
  );
  await page.goto('/__design/logos');
  await page.evaluate(() => Promise.all(Array.from(document.images, (img) => img.decode())));
  await expect(page.getByRole('heading', { name: '01 / Orbit' })).toBeVisible();
  await page.screenshot({ path: 'docs/design/logos/concepts.png', fullPage: true });
});
