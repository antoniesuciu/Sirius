import { strict as assert } from 'node:assert';
import { mkdir } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const browser = await chromium.launch({ args: ['--no-sandbox'] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1280 }, deviceScaleFactor: 1 });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('http://127.0.0.1:5186');
  await page.locator('.hero svg').waitFor();
  assert.equal(await page.locator('svg.orbit-avatar').count(), 6);
  const hero = page.locator('.hero svg');
  const star = hero.locator('.orbit-star');
  const transform = () => star.getAttribute('transform');
  for (const [state, label] of [['idle', 'Idle'], ['listening', 'Listening'], ['thinking', 'Thinking'], ['speaking', 'Speaking'], ['needs_input', 'Needs input']]) {
    await page.getByRole('button', { name: new RegExp(`0[1-5].*${label}`) }).click();
    assert.equal(await hero.getAttribute('data-state'), state);
  }
  await page.waitForTimeout(250);
  assert.equal(await star.evaluate((el) => getComputedStyle(el).fill), 'rgb(243, 185, 106)');
  await page.getByRole('button', { name: /04.*Speaking/ }).click();
  await page.getByLabel('Simulated voice amplitude').uncheck();
  await page.getByRole('slider', { name: 'Voice level' }).fill('0');
  await page.waitForTimeout(250);
  const silent = await transform();
  await page.getByRole('slider', { name: 'Voice level' }).fill('1');
  await page.waitForTimeout(250);
  assert.notEqual(await transform(), silent, 'speaking responds to amplitude');
  await page.getByRole('slider', { name: 'Voice level' }).fill('0');
  await page.waitForTimeout(250);
  assert.equal(await transform(), silent, 'silence returns to rest');
  await page.getByRole('button', { name: /03.*Thinking/ }).click();
  const track = hero.locator('.orbit-track');
  const before = await track.getAttribute('transform');
  await page.waitForTimeout(300);
  assert.notEqual(await track.getAttribute('transform'), before, 'highlight rotates');
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  const paused = await track.getAttribute('transform');
  await page.waitForTimeout(250);
  assert.equal(await track.getAttribute('transform'), paused, 'pause stops movement');
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForTimeout(100);
  const reduced = await track.getAttribute('transform');
  await page.waitForTimeout(250);
  assert.equal(await track.getAttribute('transform'), reduced, 'reduced motion stops movement');
  assert.equal(await hero.getAttribute('data-running'), 'false');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.getByLabel('Simulated voice amplitude').check();
  await mkdir('docs/design/orbit-motion/captures', { recursive: true });
  await page.screenshot({ path: 'docs/design/orbit-motion/captures/preview-dark.png', fullPage: true });
  if (process.argv.includes('--capture')) {
    await mkdir('/tmp/sirius-orbit-frames', { recursive: true });
    const strip = page.locator('.studies');
    for (let i = 0; i < 60; i++) {
      await strip.screenshot({ path: `/tmp/sirius-orbit-frames/${String(i).padStart(3, '0')}.png`, animations: 'allow' });
      await page.waitForTimeout(80);
    }
  }
  await page.getByRole('button', { name: 'Light canvas' }).click();
  await page.screenshot({ path: 'docs/design/orbit-motion/captures/preview-light.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'phone has no horizontal overflow');
  await page.screenshot({ path: 'docs/design/orbit-motion/captures/preview-phone.png', fullPage: true });
  assert.deepEqual(errors, [], 'no browser errors');
  console.log('Verified: five states, voice amplitude and silence, moving highlight, pause, live reduced motion, phone layout, no browser errors.');
} finally {
  await browser.close();
}
