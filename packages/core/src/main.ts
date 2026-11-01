/** The `sirius-core` process. */
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { AgentId } from '@sirius/contracts';
import systemPrompt from '../prompts/sirius.md' with { type: 'text' };
import { createClaudeAdapter } from './agents/claude.ts';
import { createCodexAdapter } from './agents/codex.ts';
import type { AdapterOptions } from './agents/types.ts';
import { loadConfig, loadOrCreateToken } from './config.ts';
import { createCore } from './core.ts';
import { createApp } from './http/app.ts';
import { LibnotifyNotifier } from './notifier.ts';
import { serve } from './runtime/serve.ts';
import { seedDemo } from './seed.ts';

const VERSION = '0.1.0';

const config = loadConfig();
mkdirSync(config.dataDir, { recursive: true });
const agentCwd = join(config.dataDir, 'agent-cwd');
mkdirSync(agentCwd, { recursive: true });

// SIRIUS_MCP_COMMAND lets development point at the TypeScript source.
const [mcpBin = 'sirius-mcp', ...mcpArgs] = (process.env.SIRIUS_MCP_COMMAND ?? 'sirius-mcp').split(
  ' ',
);
const adapterBase: Omit<AdapterOptions, 'bin'> = {
  cwd: agentCwd,
  systemPrompt,
  mcp: (agent: AgentId) => ({
    command: mcpBin,
    args: [...mcpArgs, '--agent', agent],
    env: {
      SIRIUS_VIA: 'chat',
      SIRIUS_PORT: String(config.port),
      SIRIUS_TOKEN_FILE: config.tokenFile,
    },
  }),
};

const core = createCore({
  dbPath: join(config.dataDir, 'sirius.sqlite'),
  backupDir: join(config.dataDir, 'backups'),
  timeZone: config.timeZone,
  notifier: new LibnotifyNotifier(),
  adapters: {
    claude: createClaudeAdapter({ ...adapterBase, bin: process.env.SIRIUS_CLAUDE_BIN ?? 'claude' }),
    codex: createCodexAdapter({ ...adapterBase, bin: process.env.SIRIUS_CODEX_BIN ?? 'codex' }),
  },
});
if (process.env.SIRIUS_SEED === 'demo') seedDemo(core);
core.scheduler.start();
void core.chat.refreshAvailability();

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
