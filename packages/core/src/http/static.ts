/** Serves the built UI from the core, which is how the phone gets it (ADR-9). */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';
import type { OpenAPIHono } from '@hono/zod-openapi';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};

export function serveUi(app: OpenAPIHono, dir: string): void {
  const root = resolve(dir);
  app.get('*', (c) => {
    const pathname = decodeURIComponent(new URL(c.req.url).pathname);
    const wanted = resolve(join(root, pathname));
    // `..` in a path must not walk out of the UI folder.
    if (wanted !== root && !wanted.startsWith(root + sep)) return c.notFound();
    const isFile = existsSync(wanted) && statSync(wanted).isFile();
    const file = isFile ? wanted : join(root, 'index.html');
    if (!existsSync(file)) return c.notFound();
    const type = TYPES[extname(file)] ?? 'application/octet-stream';
    return new Response(readFileSync(file), { headers: { 'content-type': type } });
  });
}
