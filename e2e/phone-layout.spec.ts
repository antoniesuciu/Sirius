/**
 * The phone layout and phone voice (F38), on the fixture backend. Only the phone project runs
 * these: the desktop columns are covered by dashboard.spec.ts at both sizes.
 */
import { expect, type Page, test } from '@playwright/test';

test.skip(({ isMobile }) => !isMobile, 'phone only');

const openPhone = (page: Page) => page.goto('/?fixtures&phone&toastMs=600000');
const tab = (page: Page, name: string) => page.locator('.tab-bar .tab', { hasText: name });

/** Records what the page asks the phone to say, instead of saying it. */
async function captureSpeech(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const said: Array<{ text: string; lang: string }> = [];
    Object.assign(window, { said });
    class Utterance {
      lang = '';
      voice: unknown = null;
      onend: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(readonly text: string) {}
    }
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { value: Utterance });
    Object.defineProperty(window, 'speechSynthesis', {
      value: {
        getVoices: () => [],
        cancel: () => {},
        speak: (u: Utterance) => {
          said.push({ text: u.text, lang: u.lang });
          setTimeout(() => u.onend?.(), 50);
        },
      },
    });
  });
}

test('the phone opens on Sirius and shows one section at a time', async ({ page }) => {
  await openPhone(page);
  await expect(page.locator('.panel-sirius')).toBeVisible();
  await expect(page.locator('.task').first()).toBeHidden();
  await expect(tab(page, 'Sirius')).toHaveAttribute('aria-current', 'page');

  await tab(page, 'Today').click();
  await expect(page.locator('.task').first()).toBeVisible();
  await expect(page.locator('.panel-sirius')).toBeHidden();

  await tab(page, 'Plan').click();
  await expect(page.locator('.goal-title').first()).toBeVisible();
  await tab(page, 'List').click();
  await expect(page.getByLabel('Add to the list', { exact: true })).toBeVisible();

  // Nothing scrolls the whole page any more: the section scrolls inside its own area.
  const pageScrolls = await page.evaluate(
    () => document.documentElement.scrollHeight > window.innerHeight + 1,
  );
  expect(pageScrolls).toBe(false);
});

test('a draft survives switching sections', async ({ page }) => {
  await openPhone(page);
  await page.getByLabel('Message Sirius').fill('half a thought');
  await tab(page, 'Today').click();
  await tab(page, 'Sirius').click();
  await expect(page.getByLabel('Message Sirius')).toHaveValue('half a thought');
});

test('a reply links to what it changed, and that section says something is new', async ({
  page,
}) => {
  await openPhone(page);
  await page.getByLabel('Message Sirius').fill('add goal: Run a 10k');
  await page.getByLabel('Message Sirius').press('Enter');
  await expect(tab(page, 'Plan').locator('.tab-dot')).toBeVisible();
  const receipt = page.getByRole('button', { name: /Changed Goals/ });
  await expect(receipt).toBeVisible();

  await receipt.click();
  await expect(tab(page, 'Plan')).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('.goal-title', { hasText: 'Run a 10k' })).toBeVisible();
  await expect(tab(page, 'Plan').locator('.tab-dot')).toHaveCount(0);
});

test('talking to the phone: it records, the laptop acts, and the phone says the answer', async ({
  page,
}) => {
  await captureSpeech(page);
  await openPhone(page);
  await tab(page, 'Today').click();

  await page.getByRole('button', { name: 'Talk to Sirius' }).click();
  // The mic takes you to the conversation, where the answer appears.
  await expect(tab(page, 'Sirius')).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('.sirius-status')).toHaveText('listening');
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: 'Stop listening' }).click();

  const log = page.locator('.chat-log');
  await expect(log).toContainText('add water the basil to today');
  await expect(log).toContainText('Added water the basil to today.');
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { said: unknown[] }).said))
    .toEqual([{ text: 'Added water the basil to today.', lang: 'en-US' }]);

  await expect(tab(page, 'Today').locator('.tab-dot')).toBeVisible();
  await page.getByRole('button', { name: /Changed Today/ }).click();
  await expect(page.locator('.task', { hasText: 'Water the basil' })).toBeVisible();
});

test('without the phone flag a narrow browser keeps the desktop columns', async ({ page }) => {
  await page.goto('/?fixtures&toastMs=600000');
  await expect(page.locator('.tab-bar')).toHaveCount(0);
  await expect(page.locator('.task').first()).toBeVisible();
});

test('screenshots for review', async ({ page }) => {
  test.skip(!process.env.SIRIUS_SHOTS, 'only when asked for');
  const dir = process.env.SIRIUS_SHOTS ?? '';
  await openPhone(page);
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${dir}/sirius.png` });
  await page.getByLabel('Message Sirius').fill('add goal: Run a 10k');
  await page.getByLabel('Message Sirius').press('Enter');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${dir}/receipt.png` });
  await tab(page, 'Today').click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${dir}/today.png` });
  await tab(page, 'Plan').click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${dir}/plan.png` });
});
