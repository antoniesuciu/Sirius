/** The `sirius-core` process. */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig, loadOrCreateToken } from './config.ts';
import { createCore } from './core.ts';
import { createApp } from './http/app.ts';
import { LibnotifyNotifier } from './notifier.ts';
import { serve } from './runtime/serve.ts';
import { seedDemo } from './seed.ts';

const VERSION = '0.1.0';

const config = loadConfig();
mkdirSync(config.dataDir, { recursive: true });
const core = createCore({
  dbPath: join(config.dataDir, 'sirius.sqlite'),
  backupDir: join(config.dataDir, 'backups'),
  timeZone: config.timeZone,
  notifier: new LibnotifyNotifier(),
});
if (process.env.SIRIUS_SEED === 'demo') seedDemo(core);
core.scheduler.start();

const app = createApp(core, {
  token: loadOrCreateToken(config.tokenFile),
  mode: config.mode,
  version: VERSION,
});
const hostname = config.mode === 'remote' ? '0.0.0.0' : '127.0.0.1';
const server = serve(app.fetch, { port: config.port, hostname });
console.log(`sirius-core listening on ${hostname}:${server.port}`);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.stop();
    core.close();
    process.exit(0);
  });
}
