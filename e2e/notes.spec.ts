import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';

/** F42's notes page, opened straight from the address. */
const openNotes = async (page: Page, note = '') => {
  await page.goto(`/?fixtures&toastMs=600000&notes${note ? `=${note}` : ''}`);
  const view = page.getByRole('dialog', { name: 'Notes' });
  await expect(view).toBeVisible();
  return view;
};

test('the notes page lists folders with counts, searches, and finds nothing plainly', async ({
  page,
}) => {
  const view = await openNotes(page);
  const folders = view.getByRole('navigation', { name: 'Folders' });
  await expect(folders.getByRole('button', { name: 'All notes 2' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(folders.getByRole('button', { name: 'Stocks 1' })).toBeVisible();
  await expect(folders.getByRole('button', { name: 'No folder 1' })).toBeVisible();
  // Pinned first.
  await expect(view.locator('.note-row-title')).toHaveText(['Reading list', 'NVDA thesis']);

  // `/` jumps to the search; it matches the body too, ignoring case.
  await page.keyboard.press('/');
  await expect(view.getByLabel('Search notes')).toBeFocused();
  await page.keyboard.type('EXIT BELOW');
  await expect(view.locator('.note-row-title')).toHaveText(['NVDA thesis']);
  await view.getByLabel('Search notes').fill('zebra');
  await expect(view.getByText('No notes match "zebra".')).toBeVisible();
  // Escape clears the search before it leaves the page.
  await page.keyboard.press('Escape');
  await expect(view.getByLabel('Search notes')).toHaveValue('');
  await expect(view).toBeVisible();

  await folders.getByRole('button', { name: 'Stocks 1' }).click();
  await expect(view.locator('.note-row-title')).toHaveText(['NVDA thesis']);
  await folders.getByRole('button', { name: 'Delete folder: Stocks' }).click();
  await expect(view.getByText('Deleting Stocks also deletes the 1 note in it.')).toBeVisible();
  await view.getByRole('button', { name: 'Keep' }).click();

  await page.keyboard.press('Escape');
  await expect(view).toHaveCount(0);
  await expect(page).not.toHaveURL(/notes/);
});

test('a new note is one surface: the first line is its title, and it saves itself', async ({
  page,
}) => {
  const view = await openNotes(page);
  await view.getByRole('button', { name: 'New note' }).click();
  const surface = view.getByLabel('Note', { exact: true });
  await expect(surface).toBeFocused();
  await expect(page).toHaveURL(/notes=f\d+/);
  await surface.fill('Groceries\nRice and tomatoes.');
  await expect(view.locator('.note-save')).toHaveText('Saved', { timeout: 3000 });
  await expect(view.getByText('4 words')).toBeVisible();
  await expect(view.locator('.note-row-title').first()).toHaveText('Reading list');
  await expect(view.locator('.note-row', { hasText: 'Groceries' })).toContainText(
    'Rice and tomatoes.',
  );

  // Pinned, it moves above the older pin.
  await view.getByRole('button', { name: 'Pin', exact: true }).click();
  await expect(view.getByRole('button', { name: 'Pinned', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(view.locator('.note-row-title').first()).toHaveText('Groceries');
});

test('deleting a note offers Undo instead of asking first', async ({ page }) => {
  const view = await openNotes(page);
  await view.getByRole('button', { name: /^NVDA thesis/ }).click();
  await view.getByRole('button', { name: 'Delete note: NVDA thesis' }).click();
  await expect(view.locator('.note-row-title')).toHaveText(['Reading list']);
  await view.getByRole('status').getByRole('button', { name: 'Undo' }).click();
  await expect(view.locator('.note-row-title')).toHaveText(['Reading list', 'NVDA thesis']);
});

test('deleting a folder takes its notes, and Undo brings both back', async ({ page }) => {
  const view = await openNotes(page);
  await view.getByRole('button', { name: /^Stocks/ }).click();
  await view.getByRole('button', { name: 'Delete folder: Stocks' }).click();
  await view.getByRole('button', { name: 'Delete folder and notes' }).click();
  await expect(view.locator('.note-row-title')).toHaveText(['Reading list']);
  await view.getByRole('status').getByRole('button', { name: 'Undo' }).click();
  await expect(view.locator('.note-row-title')).toHaveText(['Reading list', 'NVDA thesis']);
  await expect(view.getByRole('button', { name: /^Stocks/ })).toBeVisible();
});

test('on a phone the list and the note take turns', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'phone only');
  const view = await openNotes(page);
  await expect(view.getByRole('region', { name: 'Open note' })).toBeHidden();
  await view.getByRole('button', { name: /^Reading list/ }).click();
  await expect(view.getByRole('region', { name: 'Note list' })).toBeHidden();
  await expect(view.getByLabel('Note', { exact: true })).toHaveValue(
    'Reading list\nAbbott, chapter 3.',
  );
  await view.getByRole('button', { name: 'Notes', exact: true }).click();
  await expect(view.getByRole('region', { name: 'Note list' })).toBeVisible();
  // Escape also steps back from the note to the list, and Ctrl+Enter starts a new one.
  await view.getByRole('button', { name: /^NVDA thesis/ }).click();
  await page.keyboard.press('Escape');
  await expect(view.getByRole('region', { name: 'Note list' })).toBeVisible();
  await expect(view).toBeVisible();
  await page.keyboard.press('Control+Enter');
  await expect(view.getByLabel('Note', { exact: true })).toBeFocused();
});

test('on a wide window the three panes sit side by side', async ({ page, isMobile }) => {
  test.skip(isMobile, 'desktop only');
  const view = await openNotes(page);
  const boxes = await Promise.all(
    ['.notes-folders', '.notes-list-pane', '.notes-editor-pane'].map((s) =>
      view.locator(s).boundingBox(),
    ),
  );
  const xs = boxes.map((b) => b?.x ?? 0);
  expect(xs[0]).toBeLessThan(xs[1] ?? 0);
  expect(xs[1]).toBeLessThan(xs[2] ?? 0);
});

test('the notes page is accessible, fits the width, and its controls are big enough', async ({
  page,
}) => {
  const view = await openNotes(page);
  await view.getByRole('button', { name: /^NVDA thesis/ }).click();
  await page.waitForTimeout(500); // Let the editor's fade finish: axe reads live opacity.
  expect(await view.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  const result = await new AxeBuilder({ page }).include('.notes-dialog').analyze();
  expect(result.violations.map((v) => `${v.id}: ${v.nodes[0]?.html}`)).toEqual([]);
  const small = await view.evaluate((el) =>
    [...el.querySelectorAll<HTMLElement>('button, input, select, textarea')]
      .filter((c) => c.getClientRects().length > 0)
      .filter((c) => c.getBoundingClientRect().height < 44)
      .map((c) => c.getAttribute('aria-label') ?? c.textContent),
  );
  expect(small).toEqual([]);
});
