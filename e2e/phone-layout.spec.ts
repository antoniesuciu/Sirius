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

test('on Sirius only the chat scrolls, even on a short screen', async ({ page }) => {
  // Shorter than the Pixel 7: Chrome's own bars take room on a real phone.
  await page.setViewportSize({ width: 390, height: 700 });
  await openPhone(page);
  for (let i = 0; i < 6; i++) {
    await page.getByLabel('Message Sirius').fill(`message ${i}`);
    await page.getByLabel('Message Sirius').press('Enter');
    await expect(page.locator('.chat-log')).toContainText(`message ${i}`);
    await expect(page.getByRole('button', { name: 'Send' })).toBeEnabled();
  }
  const sizes = await page.evaluate(() => {
    const scrolls = (selector: string) => {
      const el = document.querySelector(selector) as HTMLElement;
      return el.scrollHeight > el.clientHeight + 1;
    };
    return {
      page: document.documentElement.scrollHeight > window.innerHeight + 1,
      section: scrolls('.phone-body'),
      chat: scrolls('.chat-log'),
    };
  });
  expect(sizes).toEqual({ page: false, section: false, chat: true });
  // The agent and model sit beside the avatar rather than under it.
  const avatar = await page.locator('.panel-sirius .sirius').boundingBox();
  const agents = await page.getByRole('group', { name: 'Agent' }).boundingBox();
  expect(agents?.x).toBeGreaterThan((avatar?.x ?? 0) + (avatar?.width ?? 0) - 1);
  expect(agents?.y).toBeLessThan((avatar?.y ?? 0) + (avatar?.height ?? 0));
});

test('a new chat is started from the top of the card, not a row of its own', async ({ page }) => {
  await openPhone(page);
  await expect(page.locator('.chat-foot')).toHaveCount(0);
  await page.getByLabel('Message Sirius').fill('add goal: Run a 10k');
  await page.getByLabel('Message Sirius').press('Enter');
  await expect(page.locator('.chat-log')).toContainText('Added the goal');
  await page.getByRole('button', { name: 'New chat' }).click();
  await expect(page.locator('.chat-log')).not.toContainText('Added the goal');
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
