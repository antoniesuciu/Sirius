/** The `sirius` command. Each subcommand stays small; the core does the real work. */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import {
  AgentEventKind,
  AgentId,
  createHttpClient,
  type OpInput,
  type SiriusClient,
} from '@sirius/contracts';
import { applyClaude, applyCodex, mergeClaudeSettings, mergeCodexConfig } from './hooks.ts';
import { fromClaudeHook, fromCodexJson, readStdin } from './notify.ts';

const HOOK_TIMEOUT_MS = 1000;

const dataDir = process.env.SIRIUS_DATA_DIR ?? join(homedir(), '.local/share/sirius');
const coreUrl =
  process.env.SIRIUS_CORE_URL ?? `http://127.0.0.1:${process.env.SIRIUS_PORT ?? 7337}`;
const tokenFile = process.env.SIRIUS_TOKEN_FILE ?? join(dataDir, 'token');

function readToken(): string | undefined {
  try {
    return readFileSync(tokenFile, 'utf8').trim();
  } catch {
    return undefined;
  }
}

function client(fetchTimeoutMs?: number): SiriusClient {
  const token = readToken();
  return createHttpClient({
    baseUrl: coreUrl,
    ...(token ? { token } : {}),
    ...(fetchTimeoutMs
      ? {
          fetch: ((input: string, init?: RequestInit) =>
            fetch(input, { ...init, signal: AbortSignal.timeout(fetchTimeoutMs) })) as typeof fetch,
        }
      : {}),
  });
}

async function notify(args: string[]): Promise<void> {
  // Whatever goes wrong here stays here: exiting non-zero would disturb the agent.
  try {
    const { values, positionals } = parseArgs({
      args,
      allowPositionals: true,
      options: {
        source: { type: 'string' },
        kind: { type: 'string' },
        project: { type: 'string' },
        message: { type: 'string' },
        'from-codex-json': { type: 'boolean' },
      },
    });
    let input: OpInput<'post_agent_event'>;
    if (values['from-codex-json']) {
      input = fromCodexJson(positionals[0] ?? '{}');
    } else {
      const kind = AgentEventKind.parse(values.kind ?? 'needs_input');
      const stdin = AgentId.parse(values.source) === 'claude' ? await readStdin() : '';
      input = stdin
        ? fromClaudeHook(stdin, kind)
        : {
            source: AgentId.parse(values.source),
            kind,
            ...(values.project ? { project: values.project } : {}),
            ...(values.message ? { message: values.message } : {}),
          };
    }
    await client(HOOK_TIMEOUT_MS).call('post_agent_event', input);
  } catch {
    // Deliberately silent. A hook must never fail an agent.
  }
}

function setupHooks(args: string[]): void {
  const { values } = parseArgs({
    args,
    options: { apply: { type: 'boolean' }, 'with-stop': { type: 'boolean' } },
  });
  const bin = join(homedir(), '.local/bin/sirius');
  const claudePath = join(homedir(), '.claude/settings.json');
  const codexPath = join(homedir(), '.codex/config.toml');
  const withStop = values['with-stop'] ?? false;

  if (values.apply) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    console.log(applyClaude(claudePath, bin, withStop, stamp));
    console.log(applyCodex(codexPath, bin, stamp));
    return;
  }
  console.log('Nothing was changed. Run with --apply to merge these, with backups first.\n');
  console.log(`In ${claudePath}:`);
  console.log(JSON.stringify(mergeClaudeSettings({}, bin, { withStop }), null, 2));
  console.log(`\nIn ${codexPath}:`);
  console.log(mergeCodexConfig('', bin).text);
}

function commandWorks(bin: string, args: string[]): boolean {
  try {
    execFileSync(bin, args, { stdio: 'ignore', timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

async function doctor(): Promise<void> {
  const line = (ok: boolean, text: string) => console.log(`${ok ? 'ok  ' : 'no  '} ${text}`);
  const healthy = await fetch(`${coreUrl}/v1/health`, { signal: AbortSignal.timeout(1000) }).then(
    (r) => r.ok,
    () => false,
  );
  line(healthy, `core at ${coreUrl}${healthy ? '' : ' (systemctl --user start sirius-core)'}`);
  line(existsSync(tokenFile), `token at ${tokenFile}`);
  line(commandWorks('claude', ['--version']), 'claude CLI');
  line(commandWorks('codex', ['--version']), 'codex CLI');
  line(commandWorks('notify-send', ['--version']), 'notify-send');
  line(
    commandWorks('sirius-mcp', ['--help']) || existsSync(join(homedir(), '.local/bin/sirius-mcp')),
    'sirius-mcp',
  );
  if (healthy) {
    const { agents } = await client().call('get_agents', {});
    for (const agent of agents) {
      line(agent.status !== 'unavailable', `${agent.label}: ${agent.reason ?? 'ready'}`);
    }
  }
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  switch (command) {
    case 'notify':
      return notify(rest);
    case 'setup-hooks':
      return setupHooks(rest);
    case 'doctor':
      return doctor();
    case 'backup': {
      const { path } = await client().call('create_backup', {});
      console.log(path);
      return;
    }
    case 'voice':
      if (rest[0] === 'ptt') {
        await client(HOOK_TIMEOUT_MS).call('voice_ptt', {});
        return;
      }
      break;
  }
  console.log(
    'Usage: sirius notify | setup-hooks [--apply] [--with-stop] | doctor | backup | voice ptt',
  );
  process.exitCode = command ? 1 : 0;
}

await main();
