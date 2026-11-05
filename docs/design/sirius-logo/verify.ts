/**
 * Opens both playgrounds, steps through every state, fails on any page error, and writes
 * captures to captures/. Run `bun run --cwd docs/design/sirius-logo dev` first, then
 * `PLAYWRIGHT_BROWSERS_PATH=$TMPDIR/pw bun docs/design/sirius-logo/verify.ts`.
 */
import { mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';

const base = process.env.PLAYGROUND_URL ?? 'http://127.0.0.1:5187';
const out = new URL('./captures/', import.meta.url).pathname;
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const errors: string[] = [];
for (const [page, states] of [
  ['mark', 5],
  ['logo', 9],
] as const) {
  const tab = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  tab.on('pageerror', (e) => errors.push(`${page}: ${e.message}`));
  tab.on('console', (m) => m.type() === 'error' && errors.push(`${page}: ${m.text()}`));
  await tab.goto(`${base}/${page}.html`);
  for (let i = 1; i <= states; i++) {
    await tab.keyboard.press(String(i));
    await tab.waitForTimeout(page === 'logo' && i === 4 ? 2200 : 900);
    const name = await tab.locator('.caption strong').textContent();
    await tab.locator('.stage').screenshot({ path: `${out}/${page}-${i}-${name?.toLowerCase()}.png` });
  }
  await tab.close();
}
await browser.close();
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log('both playgrounds: every state ran with no page errors');
