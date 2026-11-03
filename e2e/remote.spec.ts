import { expect, test } from '@playwright/test';

test('the core serves the whole app at phone size', async ({ page }) => {
  await page.goto('/');
  await page.locator('.tab-bar .tab', { hasText: 'Today' }).click();
  await expect(page.locator('.task', { hasText: 'Ten pages of Abbott' })).toBeVisible();
  await page.locator('.tab-bar .tab', { hasText: 'Plan' }).click();
  await expect(page.locator('.goal-title').first()).toBeVisible();
  await expect(page.locator('.node-title').first()).toHaveText('Real analysis');
});

test('changes made on the phone reach the core', async ({ page }) => {
  await page.goto('/');
  await page.locator('.tab-bar .tab', { hasText: 'Today' }).click();
  await page.getByLabel('Add a task', { exact: true }).fill('From the phone');
  await page.getByRole('button', { name: 'Add task' }).click();
  await page.reload();
  await page.locator('.tab-bar .tab', { hasText: 'Today' }).click();
  await expect(page.locator('.smalls')).toContainText('From the phone');
});

test('it can be added to a home screen', async ({ page, request }) => {
  await page.goto('/');
  const href = await page.locator('link[rel=manifest]').getAttribute('href');
  const manifest = await (await request.get(`/${href}`)).json();
  expect(manifest).toMatchObject({ name: 'Sirius', display: 'standalone' });
  for (const icon of manifest.icons) {
    const response = await request.get(`/${icon.src}`);
    expect(response.headers()['content-type']).toBe('image/png');
  }
  expect((await request.get('/sw.js')).ok()).toBe(true);
});

test('the bundle carries no token', async ({ request, page }) => {
  await page.goto('/');
  const script = await page.locator('script[type=module]').getAttribute('src');
  const body = await (await request.get(`/${script}`)).text();
  expect(body).not.toContain('e2e-token');
});
