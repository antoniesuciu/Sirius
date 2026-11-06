/**
 * The README's screenshots, from the built-in demo data so no real day ever lands in them.
 * Run on purpose only: SIRIUS_README_SHOTS=1 bunx playwright test readme-shots
 */
import { expect, type Page, test } from '@playwright/test';

test.skip(!process.env.SIRIUS_README_SHOTS, 'only when asked for');

const OUT = 'docs/images';

async function say(page: Page, text: string): Promise<void> {
  await page.getByLabel('Message Sirius').fill(text);
  await page.getByLabel('Message Sirius').press('Enter');
  await expect(page.getByRole('button', { name: 'Send' })).toBeEnabled();
}

test('desktop', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop');
  await page.goto('/?fixtures&toastMs=600000');
  await expect(page.locator('h1')).toContainText('matter today.');
  await page.waitForTimeout(1500); // the logo finishes drawing in
  await page.screenshot({ path: `${OUT}/desktop.png` });
  await say(page, 'theme midnight');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'midnight');
  await say(page, 'add goal: Run a 10k');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/desktop-midnight.png` });
});

test('phone', async ({ page }, info) => {
  test.skip(info.project.name !== 'phone');
  const tab = (name: string) => page.locator('.tab-bar .tab', { hasText: name });
  await page.goto('/?fixtures&phone&toastMs=600000');
  await expect(page.locator('.task').first()).toBeVisible();
  // The phone opens on the logo drawing itself in; wait until it has left.
  await expect(page.locator('.launch')).toHaveCount(0, { timeout: 15_000 });
  await page.screenshot({ path: `${OUT}/phone.png` });
  await tab('Sirius').click();
  await say(page, 'add goal: Run a 10k');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/phone-sirius.png` });
  await tab('Plan').click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/phone-plan.png` });
});
