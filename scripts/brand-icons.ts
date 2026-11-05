/** Package the transparent Orbit wolf artwork using Tauri's existing icon generator. */
import { copyFileSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dir, '..');
const desktop = join(root, 'apps/desktop');
const scratch = mkdtempSync(join(tmpdir(), 'sirius-orbit-icons-'));
const artwork = readFileSync(join(root, 'packages/ui/src/assets/brand/sirius-orbit.png'));
const source = join(scratch, 'orbit.svg');
// Keep the approved silhouette, using a mid-tone blue/violet ink visible on light and dark
// launchers. The alpha mask leaves the background transparent rather than adding a tile.
writeFileSync(
  source,
  `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1024" height="1024" viewBox="0 0 1024 1024"><defs><linearGradient id="ink" x2="0" y2="1"><stop stop-color="#657ec1"/><stop offset="1" stop-color="#9769ab"/></linearGradient><mask id="orbit" mask-type="alpha"><image width="1024" height="1024" preserveAspectRatio="xMidYMid meet" xlink:href="data:image/png;base64,${artwork.toString('base64')}"/></mask></defs><rect width="1024" height="1024" fill="url(#ink)" mask="url(#orbit)"/></svg>`,
);

async function generate(output: string, sizes: number[] = []) {
  const args = ['bunx', 'tauri', 'icon', source, '--fit', 'contain', '--output', output];
  for (const size of sizes) args.push('--png', String(size));
  const result = await Bun.spawn(args, { cwd: desktop, stdio: ['ignore', 'inherit', 'inherit'] })
    .exited;
  if (result !== 0) throw new Error(`Icon generator exited ${result}`);
}

const icons = join(scratch, 'desktop');
await generate(icons);
const installed = join(desktop, 'src-tauri/icons');
// Refresh the repository's existing platform icons; leave generated mobile icon trees in temp.
const generated = new Set(readdirSync(icons));
for (const file of readdirSync(installed)) {
  if (generated.has(file)) copyFileSync(join(icons, file), join(installed, file));
}
const phone = join(scratch, 'phone');
await generate(phone, [32, 192, 512]);
for (const size of [192, 512]) {
  copyFileSync(join(phone, `${size}x${size}.png`), join(desktop, `public/icon-${size}.png`));
}
copyFileSync(join(phone, '32x32.png'), join(desktop, 'public/favicon.png'));
console.log('Transparent Orbit desktop, phone and favicon assets generated.');
