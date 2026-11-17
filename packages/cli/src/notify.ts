/**
 * `sirius notify`, called from agent hooks. Hooks must never block or fail an agent, so
 * every path exits 0 and the request gives up quickly when the core is down (spec section 9).
 */
import { closeSync, existsSync, fstatSync, openSync, readFileSync, readSync } from 'node:fs';
import { basename } from 'node:path';
import type { AgentEventKind, OpInput } from '@sirius/contracts';

type AgentEventInput = OpInput<'post_agent_event'>;

const projectOf = (cwd: unknown) => (typeof cwd === 'string' && cwd ? basename(cwd) : undefined);

/** Claude Code sends the hook input as JSON on stdin. Null means not worth an alert. */
export function fromClaudeHook(raw: string, kind: AgentEventKind): AgentEventInput | null {
  const data = JSON.parse(raw) as {
    cwd?: string;
    message?: string;
    notification_type?: string;
    hook_event_name?: string;
    tool_name?: string;
  };
  // An idle session is not waiting on anything. Older hook setups still send these.
  if (data.notification_type === 'idle_prompt') return null;
  if (
    !data.notification_type &&
    (!data.hook_event_name || data.hook_event_name === 'Notification') &&
    /waiting for your input/i.test(data.message ?? '')
  )
    return null;
  let message = data.message;
  if (data.hook_event_name === 'PermissionRequest') message = 'Claude Code needs your approval';
  if (data.hook_event_name === 'PreToolUse' && data.tool_name === 'AskUserQuestion') {
    message = 'Claude Code has a question for you';
  }
  return {
    source: 'claude',
    kind,
    ...(projectOf(data.cwd) ? { project: projectOf(data.cwd) } : {}),
    ...(message ? { message: message.slice(0, 500) } : {}),
  };
}

/** The folder a Claude hook ran in, for clearing that folder's alert. Never throws. */
export function projectFromHook(raw: string): string | undefined {
  try {
    return projectOf((JSON.parse(raw) as { cwd?: unknown }).cwd);
  } catch {
    return undefined;
  }
}

/** How much of the session log to search, from the end, for the current approval settings. */
const TAIL_BYTES = 1 << 20;

/**
 * Who answers approvals in this Codex session, from its latest turn context: "user", or
 * "auto_review" when a reviewer agent decides ("Approve for me"). The hook payload does not say,
 * and the mode can change mid-session, so it is read from the session log. Never throws.
 */
export function codexReviewer(transcriptPath: unknown): string | undefined {
  if (typeof transcriptPath !== 'string' || !transcriptPath) return undefined;
  let fd: number | undefined;
  try {
    fd = openSync(transcriptPath, 'r');
    const size = fstatSync(fd).size;
    const length = Math.min(size, TAIL_BYTES);
    const buffer = Buffer.alloc(length);
    readSync(fd, buffer, 0, length, size - length);
    const text = buffer.toString('utf8');
    // shortcut: a turn whose output exceeds 1 MB hides its context; that falls back to alerting.
    const at = text.lastIndexOf('"approvals_reviewer":"');
    const policy = text.lastIndexOf('"approval_policy":"');
    if (policy >= 0 && text.startsWith('"approval_policy":"never"', policy)) return 'never';
    if (at < 0) return undefined;
    return text.slice(at + 22, text.indexOf('"', at + 22));
  } catch {
    return undefined;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/**
 * A Codex PermissionRequest hook: Codex is about to ask for an approval in this folder. Null
 * when no person will be asked: the hook also fires when a reviewer agent will decide.
 */
export function fromCodexHook(raw: string): AgentEventInput | null {
  const project = projectFromHook(raw);
  let transcript: unknown;
  try {
    transcript = (JSON.parse(raw) as { transcript_path?: unknown }).transcript_path;
  } catch {}
  const reviewer = codexReviewer(transcript);
  if (reviewer === 'auto_review' || reviewer === 'never') return null;
  return {
    source: 'codex',
    kind: 'needs_input',
    ...(project ? { project } : {}),
    message: 'Codex needs your approval',
  };
}

/** Codex passes one JSON argument. `agent-turn-complete` is the only documented type. */
export function fromCodexJson(raw: string): AgentEventInput | null {
  const data = JSON.parse(raw) as { type?: string; cwd?: string };
  if (data.type !== 'agent-turn-complete') return null;
  return {
    source: 'codex',
    kind: 'turn_complete',
    ...(projectOf(data.cwd) ? { project: projectOf(data.cwd) } : {}),
  };
}

/** Names of this process's ancestors, parent first, from /proc; none where there is no /proc. */
export function ancestors(pid = process.ppid): string[] {
  const names: string[] = [];
  for (let i = 0; i < 32 && pid > 1; i++) {
    try {
      const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
      // "pid (name) state ppid ...": the name may hold spaces and brackets, so split at the last ')'.
      const close = stat.lastIndexOf(')');
      names.push(stat.slice(stat.indexOf('(') + 1, close));
      pid = Number(stat.slice(close + 2).split(' ')[1]);
    } catch {
      break;
    }
  }
  return names;
}

// The .deb installs code.desktop; Microsoft's other packages use the reverse-DNS id.
const vscodeId = () =>
  existsSync('/usr/share/applications/code.desktop') ? 'code' : 'com.microsoft.VSCode';

/**
 * The desktop app id of the terminal this hook runs in, so clicking the alert focuses it.
 * The process tree comes first: agents started by VS Code or a VS Code shell inherit
 * TERM_PROGRAM=vscode wherever they run (2026-11-06). The environment is only the fallback for
 * a tree that is cut: an agent in a container (distrobox, under containerd-shim) or in a shell
 * orphaned to systemd. Without an id GNOME files the alert as Sirius's, so a click opens Sirius.
 */
export function terminalApp(
  names: string[] = ancestors(),
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  for (const name of names) {
    if (name === 'code') return vscodeId();
    // The kernel cuts names at 15 characters: gnome-terminal-server is "gnome-terminal-".
    if (name.startsWith('gnome-terminal')) return 'org.gnome.Terminal';
    if (name === 'terminator') return 'terminator';
  }
  // VS Code started from a terminal is likelier than the reverse, so its marker wins.
  if (env.TERM_PROGRAM === 'vscode') return vscodeId();
  if (env.TERMINATOR_UUID) return 'terminator';
  if (env.GNOME_TERMINAL_SCREEN) return 'org.gnome.Terminal';
  // Agents Sirius starts inherit the core's environment, which has none of these.
  return undefined;
}

/** Reads stdin without ever waiting long: a hook with no input must not hang the agent. */
export async function readStdin(timeoutMs = 500): Promise<string> {
  if (process.stdin.isTTY) return '';
  const chunks: Buffer[] = [];
  const read = (async () => {
    for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  })();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      read,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    // A timed-out async iterator still holds stdin open unless it is destroyed.
    process.stdin.destroy();
  }
  return Buffer.concat(chunks).toString('utf8');
}
