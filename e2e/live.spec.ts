import { readFileSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';
import { LIVE_DATA_DIR, LIVE_PORT } from '../playwright.config.ts';

const token = () => readFileSync(`${LIVE_DATA_DIR}/token`, 'utf8').trim();

/** What `curl` would do: talk to the core directly, not through the UI. */
function postToCore(path: string, body: unknown) {
  return fetch(`http://127.0.0.1:${LIVE_PORT}/v1${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token()}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const ready = (page: Page) => expect(page.locator('.task').first()).toBeVisible();

test('renders what the core has stored', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  await expect(page.locator('.task', { hasText: 'Ten pages of Abbott' })).toBeVisible();
  await expect(page.locator('.goal-title').first()).toHaveText('Understand stochastic calculus');
  await expect(page.locator('.node-title').first()).toHaveText('Real analysis');
});

test('updates live from an outside POST, with no reload', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  await page.waitForTimeout(300); // Let SSE connect.
  const res = await postToCore('/tasks', { title: 'Added from curl' });
  expect(res.status).toBe(200);
  await expect(page.locator('.smalls')).toContainText('Added from curl');
});

test('quick add survives a reload', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  await page.getByLabel('Add a task', { exact: true }).fill('Persisted');
  await page.getByRole('button', { name: 'Add task' }).click();
  await expect(page.locator('.smalls')).toContainText('Persisted');
  await page.reload();
  await expect(page.locator('.smalls')).toContainText('Persisted');
});

test('toggling shows feedback before the server answers', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  await page.route('**/v1/tasks/*/complete', async (route) => {
    await new Promise((r) => setTimeout(r, 1500));
    await route.continue();
  });
  await page.getByRole('button', { name: 'Mark done: Tidy the desk' }).click();
  await expect(page.getByRole('button', { name: 'Mark not done: Tidy the desk' })).toBeVisible({
    timeout: 300,
  });
});

test('an optimistic change rolls back when the core refuses', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  await page.route('**/v1/tasks/*/complete', (route) =>
    route.fulfill({ status: 500, json: { code: 'internal', message: 'no' } }),
  );
  await page.getByRole('button', { name: 'Mark done: Walk before sunset' }).click();
  await expect(page.getByRole('button', { name: 'Mark done: Walk before sunset' })).toBeVisible();
});

test('quiet mode reaches the core and survives a reload', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  await page.getByRole('button', { name: "I'm done for today" }).click();
  await expect(page.getByRole('button', { name: 'Welcome back' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Welcome back' })).toBeVisible();
  await page.getByRole('button', { name: 'Welcome back' }).click();
  await expect(page.getByRole('button', { name: "I'm done for today" })).toBeVisible();
});

test('fetches nothing from the network (offline, spec 4.2)', async ({ page }) => {
  const foreign: string[] = [];
  page.on('request', (r) => {
    if (!r.url().startsWith('http://127.0.0.1:4173')) foreign.push(r.url());
  });
  await page.goto('/');
  await ready(page);
  await page.waitForTimeout(500);
  expect(foreign).toEqual([]);
});
