/** `sirius setup-hooks`: wires agents to `sirius notify` (spec section 9). */
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';

const NOTIFICATION_MATCHER = 'permission_prompt|idle_prompt|elicitation_dialog';

interface CommandHook {
  type: 'command';
  command: string;
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
  const groups = (settings.hooks[event] ??= []);
  const present = groups.some((g) => g.hooks?.some((h) => h.command?.includes(marker)));
  if (!present) groups.push(group);
}

/** Adds Sirius's hooks, keeping everything already there. Safe to run twice. */
export function mergeClaudeSettings(
  existing: ClaudeSettings,
  bin: string,
  options: { withStop?: boolean } = {},
): ClaudeSettings {
  const settings = structuredClone(existing);
  addHook(
    settings,
    'Notification',
    {
      matcher: NOTIFICATION_MATCHER,
      hooks: [{ type: 'command', command: `${bin} notify --source claude --kind needs_input` }],
    },
    'notify --source claude --kind needs_input',
  );
  if (options.withStop) {
    addHook(
      settings,
      'Stop',
      {
        hooks: [{ type: 'command', command: `${bin} notify --source claude --kind turn_complete` }],
      },
      'notify --source claude --kind turn_complete',
    );
  }
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
  const line = `notify = ["${bin}", "notify", "--source", "codex", "--from-codex-json"]`;
  if (existing.includes('"--from-codex-json"')) {
    return { text: existing, changed: false, conflict: false };
  }
  if (NOTIFY_LINE.test(existing)) return { text: existing, changed: false, conflict: true };
  return { text: `${line}\n${existing}`, changed: true, conflict: false };
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
