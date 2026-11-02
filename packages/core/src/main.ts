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
import { createAccessVerifier } from './http/access.ts';
import { createApp } from './http/app.ts';
import { FanOutNotifier, LibnotifyNotifier, type Notifier, NtfyNotifier } from './notifier.ts';
import { serve } from './runtime/serve.ts';
import { seedDemo } from './seed.ts';

const VERSION = '0.1.0';

const config = loadConfig();

/** A desktop gets libnotify, and a server has no desktop. Either can add ntfy for the phone. */
function buildNotifier(): Notifier {
  const targets: Notifier[] = config.mode === 'local' ? [new LibnotifyNotifier()] : [];
  if (config.ntfyUrl) targets.push(new NtfyNotifier(config.ntfyUrl));
  return new FanOutNotifier(targets);
}

mkdirSync(config.dataDir, { recursive: true });
const agentCwd = join(config.dataDir, 'agent-cwd');
mkdirSync(agentCwd, { recursive: true });

/** Installed side by side, so this works whatever PATH the service was started with. */
function defaultMcpCommand(): string {
  const sibling = join(dirname(process.execPath), 'sirius-mcp');
  return existsSync(sibling) ? sibling : 'sirius-mcp';
}

// SIRIUS_MCP_COMMAND lets development point at the TypeScript source.
const [mcpBin = 'sirius-mcp', ...mcpArgs] = (
  process.env.SIRIUS_MCP_COMMAND ?? defaultMcpCommand()
).split(' ');
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
  notifier: buildNotifier(),
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
  ...(config.access ? { verifyAccess: createAccessVerifier(config.access) } : {}),
  ...(config.uiDir ? { uiDir: config.uiDir } : {}),
  ...(config.voiceUrl ? { voiceUrl: config.voiceUrl } : {}),
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
