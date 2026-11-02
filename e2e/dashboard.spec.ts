import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';

const open = (page: Page, query = '?fixtures&toastMs=600000') => page.goto(`/${query}`);
const typed = (page: Page) => expect(page.locator('h1 .caret')).toHaveCount(0, { timeout: 10_000 });

test.describe('window without a system title bar', () => {
  test('the desktop app draws its own controls and they reach Tauri', async ({ page }) => {
    await page.addInitScript(() => {
      const calls: string[] = [];
      Object.assign(window, {
        tauriCalls: calls,
        __TAURI_INTERNALS__: {
          metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
          invoke: async (command: string) => calls.push(command),
        },
      });
    });
    await open(page);
    await expect(page.locator('.window-drag')).toHaveAttribute('data-tauri-drag-region', 'true');
    for (const name of ['Minimise', 'Maximise', 'Close']) {
      await page.getByRole('button', { name, exact: true }).click();
    }
    const calls = await page.evaluate(
      () => (window as unknown as { tauriCalls: string[] }).tauriCalls,
    );
    expect(calls).toEqual(
      expect.arrayContaining([
        'plugin:window|minimize',
        'plugin:window|toggle_maximize',
        'plugin:window|close',
      ]),
    );
  });

  test('a browser or phone keeps its own window chrome', async ({ page }) => {
    await open(page);
    await expect(page.locator('.window-controls')).toHaveCount(0);
  });
});

test.describe('header', () => {
  test('types the greeting from the number of open priorities', async ({ page }) => {
    await open(page);
    await expect(page.locator('h1')).toContainText('Three things matter today.', {
      timeout: 10_000,
    });
  });

  test('shows the clock inline before the date, at the top of the header', async ({ page }) => {
    await open(page);
    const clock = await page.locator('.clock').boundingBox();
    const date = await page.locator('.header-time .label').boundingBox();
    const heading = await page.locator('h1').boundingBox();
    if (!clock || !date || !heading) throw new Error('header did not render');
    expect(clock.x).toBeLessThan(date.x);
    expect(clock.y + clock.height).toBeLessThanOrEqual(heading.y + 1);
    await expect(page.locator('.clock')).toHaveText(/^\d\d:\d\d$/);
  });

  test('cycles local suggestions on each press', async ({ page }) => {
    // Suggestions depend on the hour: late in the evening, rest comes first.
    await page.clock.setFixedTime(new Date('2026-11-01T15:45:00'));
    await open(page);
    const button = page.getByRole('button', { name: 'What should I do now?' });
    await button.click();
    await expect(page.locator('.suggestion')).toContainText('Derive the covariance update');
    await button.click();
    await expect(page.locator('.suggestion')).toContainText('Sequences and limits');
  });

  test('quiet mode dims Today and Goals, sleeps Sirius, and undoes', async ({ page }) => {
    await open(page);
    await page.getByRole('button', { name: "I'm done for today" }).click();
    await expect(page.getByText('Quiet until tomorrow.')).toBeVisible();
    await expect(page.locator('.sirius')).toHaveAttribute('data-state', 'asleep');
    await expect(page.locator('.sirius-status')).toHaveText('asleep until tomorrow');
    await expect(page.locator('.panel-dim')).toHaveCount(2);
    await page.getByRole('button', { name: 'Welcome back' }).click();
    await expect(page.locator('.sirius')).toHaveAttribute('data-state', 'idle');
    await expect(page.locator('.panel-dim')).toHaveCount(0);
  });
});

test.describe('today', () => {
  test('quick add plants a small task', async ({ page }) => {
    await open(page);
    await page.getByLabel('Add a task', { exact: true }).fill('Water the basil');
    await page.getByRole('button', { name: 'Add task' }).click();
    await expect(page.getByText('Planted in Today.')).toBeVisible();
    await expect(page.locator('.smalls')).toContainText('Water the basil');
  });

  test('toggling a task strikes it through and leaves it visible', async ({ page }) => {
    await open(page);
    await page.getByRole('button', { name: 'Mark done: Ten pages of Abbott' }).click();
    const done = page.getByRole('button', { name: 'Mark not done: Ten pages of Abbott' });
    await expect(done).toBeVisible();
    await expect(done.locator('.task-text')).toHaveCSS('text-decoration-line', 'line-through');
    await done.click();
    await expect(
      page.getByRole('button', { name: 'Mark done: Ten pages of Abbott' }),
    ).toBeVisible();
  });
});

test.describe('learning', () => {
  test('the current roadmap starts open and puts its step in Today', async ({ page }) => {
    await open(page);
    await expect(page.getByText('Next: Sequences and limits, §2.4.')).toBeVisible();
    await page.getByRole('button', { name: 'Put it in Today' }).click();
    await expect(page.locator('.smalls')).toContainText('Sequences and limits, §2.4');
  });

  test('selecting another roadmap swaps what is expanded', async ({ page }) => {
    await open(page);
    await page.getByRole('button', { name: /Stochastic calculus/ }).click();
    await expect(page.getByText('Nothing to do yet.')).toBeVisible();
    await expect(page.getByText('Next: Sequences and limits')).toHaveCount(0);
  });
});

test('reminder switches toggle', async ({ page }) => {
  await open(page);
  const toggle = page.getByRole('switch', { name: 'Midday pause' });
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
});

test('breathing starts and stops, with a live label', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Begin' }).click();
  await expect(page.locator('.breath-label')).toHaveText('Breathe in');
  await expect(page.locator('.breath-circle')).toHaveClass(/breathing/);
  await page.getByRole('button', { name: 'Stop' }).click();
  await expect(page.locator('.breath-label')).toHaveText('Take a minute');
});

test.describe('sirius', () => {
  test('streams a reply and shows it', async ({ page }) => {
    await open(page);
    await page.getByLabel('Message Sirius').fill('Add goal: learn to sail');
    await page.getByRole('button', { name: 'Send' }).click();
    await expect(page.locator('.bubble-me')).toHaveText('Add goal: learn to sail');
    await expect(page.locator('.chat-log')).toContainText('No deadline and no pressure', {
      timeout: 8000,
    });
    await expect(page.locator('.goal-title', { hasText: 'learn to sail' })).toBeVisible();
  });

  test('a turn that fails before its response arrives does not leave the panel stuck', async ({
    page,
  }) => {
    await open(page);
    await page.getByLabel('Message Sirius').fill('fail fast');
    await page.getByRole('button', { name: 'Send' }).click();
    await expect(page.locator('.chat-log')).toContainText('That failed straight away.');
    await expect(page.getByRole('button', { name: 'Send' })).toBeEnabled();
    await expect(page.locator('.sirius')).toHaveAttribute('data-state', 'idle');
  });

  test('a proposal changes nothing until Confirm', async ({ page }) => {
    await open(page);
    await page.getByRole('button', { name: 'I feel overwhelmed' }).click();
    const card = page.locator('.proposal');
    await expect(card).toContainText('Keep one priority', { timeout: 8000 });
    await expect(page.locator('.task')).toHaveCount(6);
    await card.getByRole('button', { name: 'Confirm' }).click();
    await expect(page.locator('.task')).toHaveCount(1);
    await expect(page.getByText('5 resting until tomorrow')).toBeVisible();
  });

  test('Not now leaves everything as it was', async ({ page }) => {
    await open(page);
    await page.getByRole('button', { name: 'I feel overwhelmed' }).click();
    await page.locator('.proposal').getByRole('button', { name: 'Not now' }).click();
    await expect(page.locator('.proposal')).toHaveCount(0);
    await expect(page.locator('.task')).toHaveCount(6);
  });

  test('the mic says so when voice is not running', async ({ page }) => {
    await open(page);
    await page.getByRole('button', { name: 'Talk to Sirius' }).click();
    await expect(page.locator('.chat-log')).toContainText("Voice isn't running right now.");
  });

  test('the model picker works by mouse and closes when you click away', async ({ page }) => {
    await open(page);
    const picker = page.getByRole('button', { name: /^Model:/ });
    await expect(picker).toContainText('Haiku');
    await picker.click();
    await page.getByRole('option', { name: 'Claude Sonnet 5.5' }).click();
    await expect(picker).toContainText('Sonnet');
    await expect(page.getByRole('listbox')).toHaveCount(0);

    await picker.click();
    await expect(page.getByRole('option', { name: 'Claude Sonnet 5.5' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await page.locator('h1').click();
    await expect(page.getByRole('listbox')).toHaveCount(0);
  });

  test('the model picker works by keyboard', async ({ page }) => {
    await open(page);
    const picker = page.getByRole('button', { name: /^Model:/ });
    await picker.focus();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('listbox')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('listbox')).toHaveCount(0);
    await expect(picker).toBeFocused();

    await page.keyboard.press('Enter');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(picker).toContainText('Sonnet');
    await expect(picker).toBeFocused();
  });

  test('the open model list has no accessibility violations', async ({ page }) => {
    await open(page);
    await page.getByRole('button', { name: /^Model:/ }).click();
    const results = await new AxeBuilder({ page }).include('.model-picker').analyze();
    expect(results.violations).toEqual([]);
  });

  test('switching agent changes the model list', async ({ page }) => {
    await open(page);
    await page.getByRole('button', { name: 'Codex', exact: true }).click();
    await expect(page.getByRole('button', { name: /^Model:/ })).toContainText(/sol/i);
    await expect(page.getByRole('button', { name: 'Codex', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
});

test('the agent toast offers Got it and Later', async ({ page }) => {
  await open(page, '?fixtures&toastMs=50');
  const toast = page.getByRole('status').filter({ hasText: 'quant-lab' });
  await expect(toast).toHaveText(/Claude is waiting for an approval in quant-lab/);
  await expect(page.getByText('Claude · waiting for you')).toBeVisible();
  await toast.getByRole('button', { name: 'Later' }).click();
  await expect(toast).toHaveCount(0);
  await expect(page.getByText('Claude · waiting for you')).toBeVisible();
});

test.describe('non-functional', () => {
  test('never scrolls sideways', async ({ page }) => {
    await open(page);
    await typed(page);
    const { scroll, client } = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }));
    expect(scroll).toBeLessThanOrEqual(client);
  });

  test('has no accessibility violations', async ({ page }) => {
    await open(page);
    await typed(page);
    await page.waitForTimeout(3000); // Let the rise animations finish: axe reads live opacity.
    const { violations } = await new AxeBuilder({ page }).analyze();
    expect(violations.map((v) => `${v.id}: ${v.nodes[0]?.html}`)).toEqual([]);
  });

  test('interactive controls meet the touch target size', async ({ page }) => {
    await open(page);
    await typed(page);
    const small = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('button, input:not([type=hidden])')]
        .filter((el) => getComputedStyle(el).opacity !== '0')
        .filter((el) => el.getBoundingClientRect().height < 38)
        .map((el) => el.getAttribute('aria-label') ?? el.textContent),
    );
    expect(small).toEqual([]);
  });

  test('every control is reachable by keyboard', async ({ page }) => {
    await open(page);
    await typed(page);
    for (let i = 0; i < 3; i += 1) await page.keyboard.press('Tab');
    await expect(page.locator(':focus')).toBeVisible();
  });
});

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('removes leaves, typing and avatar motion', async ({ page }) => {
    await open(page);
    await expect(page.locator('h1')).toContainText('matter today.');
    await expect(page.locator('h1 .caret')).toHaveCount(0);
    await expect(page.locator('.lc').first()).toBeHidden();
    const running = await page.evaluate(() =>
      document.getAnimations().map((a) => (a as CSSAnimation).animationName),
    );
    expect(running).toEqual([]);
  });
});

test.describe('resting (ADR 0004)', () => {
  const runningLoops = (page: Page) =>
    page.evaluate(
      () =>
        document.getAnimations().filter((a) => {
          const name = (a as CSSAnimation).animationName;
          return ['fall', 'sway', 'ring', 'bob'].includes(name) && a.playState === 'running';
        }).length,
    );

  test('decoration stops when the window loses focus and returns with it', async ({ page }) => {
    await open(page);
    await typed(page);
    expect(await runningLoops(page)).toBeGreaterThan(0);
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await expect(page.locator('.app')).toHaveClass(/resting/);
    expect(await runningLoops(page)).toBe(0);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(page.locator('.app')).not.toHaveClass(/resting/);
    expect(await runningLoops(page)).toBeGreaterThan(0);
  });

  test('breathing keeps going while the window rests', async ({ page }) => {
    await open(page);
    await page.getByRole('button', { name: 'Begin' }).click();
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await expect(page.locator('.app')).toHaveClass(/resting/);
    const state = await page.evaluate(
      () =>
        document.getAnimations().find((a) => (a as CSSAnimation).animationName === 'breathe')
          ?.playState,
    );
    expect(state).toBe('running');
  });
});

test('hidden windows pause every animation', async ({ page }) => {
  await open(page);
  await typed(page);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.locator('.app')).toHaveClass(/paused/);
  const states = await page.evaluate(
    () => document.getAnimations().filter((a) => a.playState === 'running').length,
  );
  expect(states).toBe(0);
});
