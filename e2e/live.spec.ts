import { readFileSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';
import { tinyPdf } from '../packages/core/test/pdf.ts';
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

test('picking a model reaches the core and survives a reload', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  const picker = page.getByRole('button', { name: /^Model:/ });
  await picker.click();
  await page.getByRole('option', { name: 'Claude Sonnet 5.5' }).click();
  await expect(picker).toContainText('Sonnet');
  await page.reload();
  await ready(page);
  await expect(page.getByRole('button', { name: /^Model:/ })).toContainText('Sonnet');
});

test('a core that cannot be reached is explained, not shown as a raw error', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  await page.route('**/v1/agents/select', (route) => route.abort('connectionrefused'));
  await page.getByRole('button', { name: /^Model:/ }).click();
  await page.getByRole('option', { name: 'Claude Opus 5.5' }).click();
  await expect(page.getByText("I can't reach my core just now.")).toBeVisible();
  await expect(page.getByRole('button', { name: /^Model:/ })).not.toContainText('Opus');
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

test('a real PDF is read by the core, with its page count (F36)', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  await page.locator('input[type=file]').setInputFiles({
    name: 'Analiză syllabus.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(tinyPdf(['Week 1: Sequences', 'Week 2: Series'], 2)),
  });
  await expect(page.getByRole('list', { name: 'Files to send' })).toContainText(
    'Analiză syllabus.pdf 2 pages',
  );
});

test('a file Sirius cannot read is explained (F36)', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  await page.locator('input[type=file]').setInputFiles({
    name: 'photo.png',
    mimeType: 'image/png',
    buffer: Buffer.from([137, 80, 78, 71]),
  });
  await expect(page.locator('.chat-log')).toContainText(
    'Sirius reads PDF, Markdown and text files',
  );
});

test('the calendar feed serves the schedule to a calendar app (F37)', async () => {
  await postToCore('/schedule', {
    title: 'Lecture',
    weekdays: 5,
    start_local: '10:00',
    end_local: '11:00',
  });
  const secret = readFileSync(`${LIVE_DATA_DIR}/calendar-token`, 'utf8').trim();
  const feed = await fetch(`http://127.0.0.1:${LIVE_PORT}/calendar/${secret}.ics`);
  expect(feed.headers.get('content-type')).toContain('text/calendar');
  const text = await feed.text();
  expect(text).toContain('SUMMARY:Lecture');
  expect(text).toContain('RRULE:FREQ=WEEKLY;BYDAY=MO,WE');
  expect((await fetch(`http://127.0.0.1:${LIVE_PORT}/calendar/wrong.ics`)).status).toBe(404);
});

test('roadmap milestone notes persist after reload', async ({ page }) => {
  const res = await postToCore('/roadmaps', {
    title: 'Persistent roadmap',
    steps: [{ title: 'Checkpoint one' }],
  });
  expect(res.ok).toBe(true);
  const roadmap = (await res.json()) as { id: string };
  await page.goto(`/?roadmap=${roadmap.id}`);
  const route = page.getByRole('dialog');
  await route
    .getByRole('textbox', { name: 'Progress notes', exact: true })
    .fill('Documented the proof and exercises.');
  await route.getByRole('button', { name: 'Save notes' }).click();
  await expect(route.getByRole('status')).toHaveText('Saved');
  await page.reload();
  await expect(route.getByRole('textbox', { name: 'Progress notes', exact: true })).toHaveValue(
    'Documented the proof and exercises.',
  );
});
