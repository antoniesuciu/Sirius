/**
 * The phone against a laptop core (ADR 0010): pairing, then the laptop going away and coming
 * back. "Away" refuses every call to the core while the phone keeps its own network, which is a
 * sleeping laptop behind Tailscale. Playwright's setOffline breaks page reloads served by a
 * service worker, so it is used only where nothing reloads.
 */
import { readFileSync } from 'node:fs';
import { type BrowserContext, expect, type Page, test } from '@playwright/test';
import { PHONE_DIR, PHONE_PORT } from '../playwright.config.ts';

const core = `http://127.0.0.1:${PHONE_PORT}/v1`;
const laptop = () => ({
  authorization: `Bearer ${readFileSync(`${PHONE_DIR}/token`, 'utf8').trim()}`,
  'content-type': 'application/json',
});

/** What `sirius pair` does on the laptop. */
async function pairingCode(): Promise<string> {
  const reply = await fetch(`${core}/phones/pairing`, { method: 'POST', headers: laptop() });
  return ((await reply.json()) as { code: string }).code;
}

async function pairedPhone(context: BrowserContext): Promise<void> {
  const reply = await fetch(`${core}/pair`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: await pairingCode(), name: 'Test phone' }),
  });
  const { token } = (await reply.json()) as { token: string };
  await context.addInitScript((t) => localStorage.setItem('sirius.phone-token', t), token);
}

async function laptopTasks(title: string): Promise<number> {
  const reply = await fetch(`${core}/today`, { headers: laptop() });
  const today = (await reply.json()) as { tasks: Array<{ title: string }> };
  return today.tasks.filter((t) => t.title === title).length;
}

/** The phone opens on Sirius (F38), so the tasks are one tap away. */
async function ready(page: Page): Promise<void> {
  await page.locator('.tab-bar .tab', { hasText: 'Today' }).click();
  await expect(page.locator('.task').first()).toBeVisible();
}
const offlineLine = (page: Page) => page.locator('.connection-line');

async function openAndKeep(page: Page): Promise<void> {
  await page.goto('/');
  await ready(page);
  // The first visit has to be enough for offline use, so wait only for the worker to be ready.
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  // The copy is written at most once a second.
  await expect
    .poll(() => page.evaluate(() => (localStorage.getItem('sirius.cache') ?? '').length))
    .toBeGreaterThan(1000);
}

const laptopAway = (context: BrowserContext) =>
  context.route('**/v1/**', (route) => route.abort('connectionrefused'));

async function laptopBack(context: BrowserContext, page: Page): Promise<void> {
  await context.unroute('**/v1/**');
  // A phone finding the laptop again usually comes with a network change or waking up.
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
}

test('a phone pairs with the code the laptop shows', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Pair this phone' })).toBeVisible();
  await page.getByLabel('Pairing code').fill(await pairingCode());
  await page.getByRole('button', { name: 'Pair' }).click();
  await ready(page);
  await expect(page.locator('.task', { hasText: 'Ten pages of Abbott' })).toBeVisible();
});

test('the link from sirius pair pairs by itself', async ({ page }) => {
  await page.goto(`/#pair=${await pairingCode()}`);
  await ready(page);
  await page.reload();
  await ready(page);
  expect(new URL(page.url()).hash).toBe('');
});

test('a wrong code says so and keeps the phone out', async ({ page }) => {
  await pairingCode();
  await page.goto('/');
  await page.getByLabel('Pairing code').fill('000000');
  await page.getByRole('button', { name: 'Pair' }).click();
  await expect(page.getByRole('alert')).toContainText('did not work');
  const reply = await page.request.get('/v1/today');
  expect(reply.status()).toBe(401);
});

test('with the laptop away, the phone shows its copy and keeps changes for later', async ({
  page,
  context,
}) => {
  await pairedPhone(context);
  await openAndKeep(page);

  await laptopAway(context);
  await page.reload();
  await ready(page);
  await expect(page.locator('.task', { hasText: 'Ten pages of Abbott' })).toBeVisible();
  await expect(offlineLine(page)).toContainText('out of reach');

  await page.getByLabel('Add a task', { exact: true }).fill('Written offline');
  await page.getByRole('button', { name: 'Add task' }).click();
  await expect(page.locator('.smalls')).toContainText('Written offline');
  await expect(offlineLine(page)).toContainText('1 change will go through');

  // Closing the app does not lose it.
  await page.waitForTimeout(1500);
  await page.reload();
  await ready(page);
  await expect(page.locator('.smalls')).toContainText('Written offline');
  await expect(offlineLine(page)).toContainText('1 change will go through');
  expect(await laptopTasks('Written offline')).toBe(0);

  await laptopBack(context, page);
  await expect(offlineLine(page)).toHaveCount(0, { timeout: 15_000 });
  await expect.poll(() => laptopTasks('Written offline'), { timeout: 15_000 }).toBe(1);
  await page.reload();
  await ready(page);
  await expect(page.locator('.smalls')).toContainText('Written offline');
  expect(await laptopTasks('Written offline')).toBe(1);
});

test('a change the laptop can no longer make is reported, not lost silently', async ({
  page,
  context,
}) => {
  await pairedPhone(context);
  await openAndKeep(page);
  const reply = await fetch(`${core}/today`, { headers: laptop() });
  const today = (await reply.json()) as { tasks: Array<{ id: string; title: string }> };
  const task = today.tasks.find((t) => t.title === 'Tidy the desk');
  if (!task) throw new Error('demo data changed');

  await context.setOffline(true);
  await page.getByRole('button', { name: 'Mark done: Tidy the desk' }).click();
  await fetch(`${core}/tasks/${task.id}/drop`, { method: 'POST', headers: laptop() });

  await context.setOffline(false);
  await expect(offlineLine(page)).toContainText('could not make one change', { timeout: 15_000 });
});

test('a phone the laptop forgot is asked to pair again', async ({ page, context }) => {
  await pairedPhone(context);
  await openAndKeep(page);
  await fetch(`${core}/phones/forget`, { method: 'POST', headers: laptop() });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Pair this phone' })).toBeVisible();
});

test("a recording reaches the laptop with the phone's login", async ({ page, context }) => {
  await pairedPhone(context);
  await page.goto('/');
  await ready(page);
  const upload = page.waitForRequest('**/v1/voice/audio');
  await page.getByRole('button', { name: 'Talk to Sirius' }).click();
  await expect(page.getByRole('button', { name: 'Stop listening' })).toBeVisible();
  await page.waitForTimeout(600);
  await page.getByRole('button', { name: 'Stop listening' }).click();
  const sent = await upload;
  expect(sent.headers().authorization).toMatch(/^Bearer /);
  // This core runs without the voice service, so getting past the login is all it can show.
  await expect(page.locator('.chat-log')).toContainText("Voice isn't running right now.");
  await expect(page.locator('.chat-log')).not.toContainText('token');
});

test('the first visit keeps everything needed to open with no network', async ({
  page,
  context,
}) => {
  // Opening fully offline is checked on a real phone: Playwright's offline mode also fails page
  // loads that a service worker serves. What it can check is that nothing is missing.
  await pairedPhone(context);
  await openAndKeep(page);
  const kept = await page.evaluate(async () => {
    const cache = await caches.open('sirius-shell-v2');
    return (await cache.keys()).map((request) => new URL(request.url).pathname);
  });
  const needed = await page.evaluate(() => [
    ...[...document.scripts].map((s) => new URL(s.src).pathname).filter((p) => p !== '/'),
    ...[...document.querySelectorAll<HTMLLinkElement>('link[rel=stylesheet]')].map(
      (l) => new URL(l.href).pathname,
    ),
  ]);
  expect(kept).toContain('/');
  for (const file of needed) expect(kept).toContain(file);
});
