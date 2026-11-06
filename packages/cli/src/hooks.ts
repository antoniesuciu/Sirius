/** `sirius setup-hooks`: wires agents to `sirius notify` (spec section 9). */
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';

/** Permissions use PermissionRequest: Notification waits until the user has been away. */
const NOTIFICATION_MATCHER = 'elicitation_dialog';

interface CommandHook {
  type: 'command';
  command: string;
  async?: boolean;
  timeout?: number;
}
interface HookGroup {
  matcher?: string;
  hooks: CommandHook[];
}
interface ClaudeSettings {
  hooks?: Record<string, HookGroup[]>;
  [key: string]: unknown;
}

function addHook(settings: ClaudeSettings, event: string, group: HookGroup, marker: string): void {
  settings.hooks ??= {};
  // Replace our definitions, including old paths and options. A mixed group keeps its
  // original matcher and other handlers; narrowing ours must not narrow theirs.
  const groups: HookGroup[] = [];
  for (const current of settings.hooks[event] ?? []) {
    const hooks = current.hooks.filter((h) => !h.command?.includes(marker));
    if (hooks.length) groups.push({ ...current, hooks });
  }
  groups.push(group);
  settings.hooks[event] = groups;
}

/** Hook commands are shell strings; ordinary executable paths stay readable. */
function shellPath(path: string): string {
  return /^[\w/.-]+$/.test(path) ? path : `'${path.replaceAll("'", "'\"'\"'")}'`;
}

/** Adds Sirius's hooks, keeping everything already there. Safe to run twice. */
export function mergeClaudeSettings(
  existing: ClaudeSettings,
  bin: string,
  options: { withStop?: boolean } = {},
): ClaudeSettings {
  const settings = structuredClone(existing);
  const command = `${shellPath(bin)} notify --source claude --kind needs_input`;
  addHook(
    settings,
    'PermissionRequest',
    { matcher: '*', hooks: [{ type: 'command', command }] },
    'notify --source claude --kind needs_input',
  );
  addHook(
    settings,
    'PreToolUse',
    { matcher: 'AskUserQuestion', hooks: [{ type: 'command', command }] },
    'notify --source claude --kind needs_input',
  );
  addHook(
    settings,
    'Notification',
    {
      matcher: NOTIFICATION_MATCHER,
      hooks: [{ type: 'command', command }],
    },
    'notify --source claude --kind needs_input',
  );
  // Either one means a permission prompt was answered, so its alert can go (2026-11-03).
  const resolve = `${shellPath(bin)} notify --source claude --resolve`;
  // A prompt or a tool also says the session is working, in whichever terminal it runs.
  const going = `${resolve} --activity working`;
  addHook(
    settings,
    'PostToolUseFailure',
    { matcher: '*', hooks: [{ type: 'command', command: going }] },
    'notify --source claude --resolve',
  );
  addHook(
    settings,
    'PostToolUse',
    { matcher: '*', hooks: [{ type: 'command', command: going }] },
    'notify --source claude --resolve',
  );
  addHook(
    settings,
    'UserPromptSubmit',
    { hooks: [{ type: 'command', command: going }] },
    'notify --source claude --resolve',
  );
  // A stopped turn clears stale attention even when completion notifications are off.
  addHook(
    settings,
    'Stop',
    {
      hooks: [
        {
          type: 'command',
          command: `${
            options.withStop
              ? `${shellPath(bin)} notify --source claude --kind turn_complete`
              : resolve
          } --activity idle`,
        },
      ],
    },
    'notify --source claude',
  );
  return settings;
}

const NOTIFY_LINE = /^\s*notify\s*=/m;

export interface CodexMerge {
  text: string;
  /** False when another `notify` is configured: replacing it is the user's decision. */
  changed: boolean;
  conflict: boolean;
}

/** TOML top-level keys must precede the first table, so the line goes at the very top. */
export function mergeCodexConfig(existing: string, bin: string): CodexMerge {
  // A finished turn is also the end of the session's work, for its status line.
  const args = [bin, 'notify', '--source', 'codex', '--activity', 'idle', '--from-codex-json'];
  const line = `notify = [${args.map((arg) => JSON.stringify(arg)).join(', ')}]`;
  const ours = existing
    .split('\n')
    .findIndex((l) => NOTIFY_LINE.test(l) && l.includes('"--from-codex-json"'));
  if (ours >= 0) {
    // Ours already: refresh it, so a moved binary or new flags reach existing installs.
    const lines = existing.split('\n');
    if (lines[ours] === line) return { text: existing, changed: false, conflict: false };
    lines[ours] = line;
    return { text: lines.join('\n'), changed: true, conflict: false };
  }
  if (NOTIFY_LINE.test(existing)) return { text: existing, changed: false, conflict: true };
  return { text: `${line}\n${existing}`, changed: true, conflict: false };
}

/**
 * Codex hooks (~/.codex/hooks.json, same shape as Claude's). `notify` in config.toml only ever
 * reports a finished turn, so approvals need PermissionRequest, which runs just before Codex asks.
 * Async, so a slow core never delays Codex; these hooks only report, they never decide.
 */
export function mergeCodexHooks(existing: ClaudeSettings, bin: string): ClaudeSettings {
  const settings = structuredClone(existing);
  const executable = shellPath(bin);
  const hook = (command: string) => ({
    type: 'command' as const,
    command,
    async: true,
    timeout: 5,
  });
  addHook(
    settings,
    'PermissionRequest',
    { matcher: '*', hooks: [hook(`${executable} notify --source codex --from-codex-hook`)] },
    'notify --source codex --from-codex-hook',
  );
  const resolve = `${executable} notify --source codex --resolve --activity working`;
  addHook(
    settings,
    'PostToolUse',
    { matcher: '*', hooks: [hook(resolve)] },
    'notify --source codex --resolve',
  );
  addHook(
    settings,
    'UserPromptSubmit',
    { hooks: [hook(resolve)] },
    'notify --source codex --resolve',
  );
  return settings;
}

export function applyCodexHooks(path: string, bin: string, stamp: string): string {
  const current = existsSync(path)
    ? (JSON.parse(readFileSync(path, 'utf8')) as ClaudeSettings)
    : {};
  const merged = mergeCodexHooks(current, bin);
  if (JSON.stringify(merged) === JSON.stringify(current)) return `${path}: already set up`;
  const backup = backupFile(path, stamp);
  writeFileSync(path, `${JSON.stringify(merged, null, 2)}\n`);
  return `${path}: updated${backup ? ` (backup at ${backup})` : ''}. Trust the new hooks once with /hooks in Codex.`;
}

/** Copies a file aside before it is touched, so an apply can always be reversed by hand. */
export function backupFile(path: string, stamp: string): string | null {
  if (!existsSync(path)) return null;
  const target = `${path}.sirius-backup-${stamp}`;
  copyFileSync(path, target);
  return target;
}

export function applyClaude(path: string, bin: string, withStop: boolean, stamp: string): string {
  const current = existsSync(path)
    ? (JSON.parse(readFileSync(path, 'utf8')) as ClaudeSettings)
    : {};
  const merged = mergeClaudeSettings(current, bin, { withStop });
  if (JSON.stringify(merged) === JSON.stringify(current)) return `${path}: already set up`;
  const backup = backupFile(path, stamp);
  writeFileSync(path, `${JSON.stringify(merged, null, 2)}\n`);
  return `${path}: updated${backup ? ` (backup at ${backup})` : ''}`;
}

export function applyCodex(path: string, bin: string, stamp: string): string {
  const current = existsSync(path) ? readFileSync(path, 'utf8') : '';
  const merged = mergeCodexConfig(current, bin);
  if (merged.conflict) return `${path}: left alone, because another notify is already configured`;
  if (!merged.changed) return `${path}: already set up`;
  const backup = backupFile(path, stamp);
  writeFileSync(path, merged.text);
  return `${path}: updated${backup ? ` (backup at ${backup})` : ''}`;
}
