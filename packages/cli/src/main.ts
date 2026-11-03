/** The `sirius` command. Each subcommand stays small; the core does the real work. */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';
import {
  AgentEventKind,
  AgentId,
  createHttpClient,
  type OpInput,
  type SiriusClient,
} from '@sirius/contracts';
import {
  applyClaude,
  applyCodex,
  applyCodexHooks,
  mergeClaudeSettings,
  mergeCodexConfig,
  mergeCodexHooks,
} from './hooks.ts';
import {
  fromClaudeHook,
  fromCodexHook,
  fromCodexJson,
  projectFromHook,
  readStdin,
} from './notify.ts';

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
        'from-codex-hook': { type: 'boolean' },
        resolve: { type: 'boolean' },
      },
    });
    if (values.resolve) {
      // The agent went on, so a permission it asked for has been answered: clear the alert.
      const source = AgentId.parse(values.source);
      // Both agents' hooks send the session's cwd as JSON on stdin.
      const project = values.project ?? projectFromHook(await readStdin());
      await client(HOOK_TIMEOUT_MS).call('resolve_agent_events', {
        source,
        ...(project ? { project } : {}),
      });
      return;
    }
    let input: OpInput<'post_agent_event'> | null;
    if (values['from-codex-hook']) {
      input = fromCodexHook(await readStdin());
    } else if (values['from-codex-json']) {
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
    if (input) await client(HOOK_TIMEOUT_MS).call('post_agent_event', input);
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
  const codexHooksPath = join(homedir(), '.codex/hooks.json');
  const withStop = values['with-stop'] ?? false;

  if (values.apply) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    console.log(applyClaude(claudePath, bin, withStop, stamp));
    console.log(applyCodex(codexPath, bin, stamp));
    console.log(applyCodexHooks(codexHooksPath, bin, stamp));
    return;
  }
  console.log('Nothing was changed. Run with --apply to merge these, with backups first.\n');
  console.log(`In ${claudePath}:`);
  console.log(JSON.stringify(mergeClaudeSettings({}, bin, { withStop }), null, 2));
  console.log(`\nIn ${codexPath}:`);
  console.log(mergeCodexConfig('', bin).text);
  console.log(`\nIn ${codexHooksPath}:`);
  console.log(JSON.stringify(mergeCodexHooks({}, bin), null, 2));
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
    existsSync(join(dirname(process.execPath), 'sirius-mcp')) ||
      existsSync(join(homedir(), '.local/bin/sirius-mcp')),
    'sirius-mcp',
  );
  if (healthy) {
    const { agents } = await client().call('get_agents', {});
    for (const agent of agents) {
      line(agent.status !== 'unavailable', `${agent.label}: ${agent.reason ?? 'ready'}`);
    }
  }
}

/** F33: one switch turns all voice off and stops the service. */
async function setVoice(enabled: boolean): Promise<void> {
  await client().call('set_setting', { key: 'voice.enabled', value: enabled });
  const action = enabled ? 'start' : 'stop';
  execFileSync('systemctl', ['--user', action, 'sirius-voice'], { stdio: 'inherit' });
  console.log(`Voice is ${enabled ? 'on' : 'off'}.`);
}

/** This laptop's Tailscale name, such as aparate.tail1234.ts.net, or null without Tailscale. */
function tailscaleHost(): string | null {
  try {
    const status = JSON.parse(
      execFileSync('tailscale', ['status', '--json'], { encoding: 'utf8' }),
    );
    const name = String(status?.Self?.DNSName ?? '').replace(/\.$/, '');
    return status?.BackendState === 'Running' && name ? name : null;
  } catch {
    return null;
  }
}

/** Puts the core on the tailnet over HTTPS. The core itself keeps listening only on 127.0.0.1. */
function ensureServed(): void {
  const target = `http://127.0.0.1:${process.env.SIRIUS_PORT ?? 7337}`;
  const current = execFileSync('tailscale', ['serve', 'status', '--json'], { encoding: 'utf8' });
  if (current.includes(target.replace('http://', ''))) return;
  console.log(`Sharing Sirius with your own Tailscale devices: tailscale serve --bg ${target}`);
  execFileSync('tailscale', ['serve', '--bg', target], { stdio: 'inherit' });
}

/** ADR 0010: a one-time code, shown as a link and, when qrencode is installed, a QR code. */
async function pairPhone(): Promise<void> {
  const host = tailscaleHost();
  if (!host) {
    console.log('Tailscale is not running on this laptop. Install it and run: sudo tailscale up');
    process.exitCode = 1;
    return;
  }
  try {
    ensureServed();
  } catch {
    console.log(
      'Tailscale would not share Sirius. Turn on HTTPS Certificates in the admin page, under DNS,',
    );
    console.log('and let this user manage Tailscale: sudo tailscale set --operator=$USER');
    process.exitCode = 1;
    return;
  }
  const { code, expires_at } = await client().call('start_phone_pairing', {});
  const url = `https://${host}/#pair=${code}`;
  console.log(`\nOn your phone, with Tailscale on, open:\n\n  ${url}\n`);
  if (commandWorks('qrencode', ['--version'])) {
    execFileSync('qrencode', ['-t', 'ansiutf8', url], { stdio: 'inherit' });
  }
  const minutes = Math.round((expires_at - Date.now()) / 60_000);
  console.log(`Or type the code ${code} there. It works once, for ${minutes} minutes.`);
  console.log("Then choose Install app in Chrome's menu to keep Sirius on your home screen.");
}

/** F37: the schedule's calendar feed, for ICSx⁵ or any app that subscribes to iCalendar. */
function calendarFeed(): void {
  const host = tailscaleHost();
  let token: string;
  try {
    token = readFileSync(join(dataDir, 'calendar-token'), 'utf8').trim();
  } catch {
    console.log('The core has not made a calendar address yet. Start it and try again.');
    process.exitCode = 1;
    return;
  }
  if (!host) {
    console.log('Tailscale is not running here, so only this laptop can reach the feed:');
    console.log(`\n  ${coreUrl}/calendar/${token}.ics\n`);
    return;
  }
  try {
    ensureServed();
  } catch {
    console.log(
      'Tailscale would not share Sirius. Turn on HTTPS Certificates and set the operator.',
    );
    process.exitCode = 1;
    return;
  }
  const url = `https://${host}/calendar/${token}.ics`;
  console.log(`\nYour schedule as a calendar:\n\n  ${url}\n`);
  if (commandWorks('qrencode', ['--version'])) {
    execFileSync('qrencode', ['-t', 'ansiutf8', url], { stdio: 'inherit' });
  }
  console.log('On Android: install ICSx⁵, add a subscription with this address, and pick');
  console.log('"Synchronize every 15 minutes". The events then appear in your calendar app and');
  console.log('its widget, with a reminder 10 minutes before each, even with the laptop off.');
  console.log('Anyone with this address can read your schedule, so keep it to yourself.');
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
    case 'pair':
      return pairPhone();
    case 'calendar':
      return calendarFeed();
    case 'forget-phones': {
      const { forgotten } = await client().call('forget_phones', {});
      console.log(`Signed out ${forgotten} phone${forgotten === 1 ? '' : 's'}.`);
      return;
    }
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
      if (rest[0] === 'on' || rest[0] === 'off') return setVoice(rest[0] === 'on');
      break;
  }
  console.log(
    'Usage: sirius notify | setup-hooks [--apply] [--with-stop] | doctor | backup | voice ptt|on|off | pair | forget-phones | calendar',
  );
  process.exitCode = command ? 1 : 0;
}

await main();
