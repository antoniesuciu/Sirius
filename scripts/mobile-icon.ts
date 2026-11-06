/**
 * Renders the Android app's launcher icon and splash from the logo's own paths (orbit.gen.ts),
 * on the night ground of the Graphite theme, with the star lit as in the app's logo.
 * Chromium draws it, so the glow is the same SVG blur the web logo uses.
 *   bun scripts/mobile-icon.ts
 */
import { chromium } from '@playwright/test';
import { ORBIT } from '../packages/ui/src/avatar/orbit.gen.ts';

const OUT = 'apps/mobile/assets/';
const [SX, SY] = ORBIT.starCentre;
const GROUND = '#16171a';

/** The mark at `scale` of the canvas, centred on the ring. */
function mark(scale: number, opts: { mono?: boolean } = {}): string {
  const [cx, cy] = ORBIT.ringCentre;
  const k = (1024 * scale) / 512;
  const t = `translate(${512 - cx * k} ${512 - cy * k}) scale(${k})`;
  const fill = opts.mono ? '#ffffff' : 'url(#g)';
  const shapes = ['head', 'earBack', 'eye', 'ring']
    .map((p) => `<path d="${ORBIT[p as keyof typeof ORBIT]}"/>`)
    .join('');
  return `<g transform="${t}" fill-rule="evenodd">
    ${opts.mono ? '' : `<g fill="#8f97e0" opacity="0.28" filter="url(#halo)">${shapes}</g>`}
    <g fill="${fill}">${shapes}</g>
    ${
      opts.mono
        ? `<path fill="#fff" d="${ORBIT.star}"/>`
        : `<path fill="#dfe3ff" d="${ORBIT.star}" filter="url(#glow)" opacity="0.95"/>
           <circle cx="${SX}" cy="${SY}" r="30" fill="#cfd5ff" opacity="0.22" filter="url(#glow)"/>
           <path fill="#f4f5ff" d="${ORBIT.star}"/>`
    }
  </g>`;
}

const defs = `<defs>
  <linearGradient id="g" gradientUnits="userSpaceOnUse" x1="213.3" y1="75" x2="214.6" y2="458.2">
    <stop offset="0" stop-color="#8496e6"/><stop offset="1" stop-color="#ad7fd0"/>
  </linearGradient>
  <radialGradient id="sky" cx="0.7" cy="0.28" r="0.95">
    <stop offset="0" stop-color="#2c2f4d"/><stop offset="0.45" stop-color="#1b1c26"/>
    <stop offset="1" stop-color="${GROUND}"/>
  </radialGradient>
  <filter id="glow" x="-150%" y="-150%" width="400%" height="400%"><feGaussianBlur stdDeviation="9"/></filter>
  <filter id="halo" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="14"/></filter>
</defs>`;

// A few faint stars: the night Sirius rises in, kept clear of the mark.
const dust = [
  [150, 170, 2.4, 0.5],
  [880, 610, 2, 0.35],
  [210, 820, 1.8, 0.3],
  [800, 880, 2.6, 0.4],
  [90, 520, 1.6, 0.3],
  [930, 260, 1.8, 0.35],
]
  .map(([x, y, r, o]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="#e6e8ff" opacity="${o}"/>`)
  .join('');
const sky = `<rect width="1024" height="1024" fill="url(#sky)"/>${dust}`;

const svg = (body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">${defs}${body}</svg>`;

const images: Record<string, string> = {
  'icon.png': svg(sky + mark(0.7)),
  'android-icon-background.png': svg(sky),
  // Launchers crop adaptive icons to a circle or squircle: art inside the central 66%.
  'android-icon-foreground.png': svg(mark(0.5)),
  'android-icon-monochrome.png': svg(mark(0.5, { mono: true })),
  'splash-icon.png': svg(mark(0.86)),
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1024, height: 1024 } });
for (const [name, body] of Object.entries(images)) {
  await page.setContent(`<style>html,body{margin:0;background:transparent}</style>${body}`);
  await page.screenshot({ path: OUT + name, omitBackground: true });
}
await browser.close();
console.log(`wrote ${Object.keys(images).join(', ')}`);
