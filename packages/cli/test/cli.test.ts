import { describe, expect, test } from 'vitest';
import { mergeClaudeSettings, mergeCodexConfig, mergeCodexHooks } from '../src/hooks.ts';
import {
  ancestors,
  fromClaudeHook,
  fromCodexHook,
  fromCodexJson,
  projectFromHook,
  terminalApp,
} from '../src/notify.ts';

const BIN = '/home/x/.local/bin/sirius';

describe('hook input', () => {
  test('Claude: project comes from cwd', () => {
    const raw = JSON.stringify({
      hook_event_name: 'Notification',
      cwd: '/home/x/code/quant-lab',
      message: 'Claude needs your permission to use Bash',
    });
    expect(fromClaudeHook(raw, 'needs_input')).toEqual({
      source: 'claude',
      kind: 'needs_input',
      project: 'quant-lab',
      message: 'Claude needs your permission to use Bash',
    });
  });

  test('Claude: an idle session is not an alert', () => {
    const idle = { cwd: '/home/x/sirius', message: 'Claude is waiting for your input' };
    expect(fromClaudeHook(JSON.stringify(idle), 'needs_input')).toBeNull();
    const typed = { cwd: '/x', message: 'x', notification_type: 'idle_prompt' };
    expect(fromClaudeHook(JSON.stringify(typed), 'needs_input')).toBeNull();
  });

  test('Claude: the folder to clear comes from the same cwd, and bad input is no folder', () => {
    const raw = JSON.stringify({ hook_event_name: 'PostToolUse', cwd: '/home/x/code/sirius' });
    expect(projectFromHook(raw)).toBe('sirius');
    expect(projectFromHook('')).toBeUndefined();
    expect(projectFromHook('{"cwd": 3}')).toBeUndefined();
  });

  test('Codex: the documented payload is a finished turn', () => {
    const raw = JSON.stringify({
      type: 'agent-turn-complete',
      cwd: '/home/x/code/lab',
      'thread-id': 't',
      'last-assistant-message': 'Done',
    });
    expect(fromCodexJson(raw)).toEqual({ source: 'codex', kind: 'turn_complete', project: 'lab' });
  });
});

describe('terminalApp', () => {
  test('names the terminal the agent runs under, so a click on the alert can focus it', () => {
    expect(terminalApp(['claude', 'zsh', 'code', 'code'])).toMatch(
      /^(code|com\.microsoft\.VSCode)$/,
    );
    expect(terminalApp(['claude', 'zsh', 'gnome-terminal-', 'systemd'])).toBe('org.gnome.Terminal');
    // The nearest terminal wins: GNOME Terminal opened from a VS Code shell.
    expect(terminalApp(['claude', 'zsh', 'gnome-terminal-', 'zsh', 'code'])).toBe(
      'org.gnome.Terminal',
    );
  });

  test('an agent with no terminal above it, such as one Sirius started, names none', () => {
    expect(terminalApp(['claude', 'bun', 'systemd'], {})).toBeUndefined();
    expect(terminalApp([], {})).toBeUndefined();
  });

  test('a cut tree, as in a distrobox container, falls back to the terminal markers', () => {
    const box = ['codex', 'zsh', 'sh', 'containerd-shim'];
    expect(terminalApp(box, { GNOME_TERMINAL_SCREEN: '/org/gnome/Terminal/screen/1' })).toBe(
      'org.gnome.Terminal',
    );
    expect(terminalApp(box, { TERM_PROGRAM: 'vscode', GNOME_TERMINAL_SCREEN: '/x' })).toMatch(
      /^(code|com\.microsoft\.VSCode)$/,
    );
    // The tree still wins over an inherited marker.
    expect(terminalApp(['zsh', 'gnome-terminal-'], { TERM_PROGRAM: 'vscode' })).toBe(
      'org.gnome.Terminal',
    );
  });

  test('reads the real process tree on Linux', () => {
    if (process.platform === 'linux') expect(ancestors(process.pid).length).toBeGreaterThan(0);
  });
});

describe('mergeClaudeSettings', () => {
  test('keeps what is there', () => {
    const existing = {
      model: 'opus',
      hooks: {
        Notification: [{ matcher: 'x', hooks: [{ type: 'command' as const, command: 'mine' }] }],
      },
    };
    const merged = mergeClaudeSettings(existing, BIN);
    expect(merged.model).toBe('opus');
    expect(merged.hooks?.Notification?.length).toBe(2);
    expect(merged.hooks?.Notification?.[0]?.hooks[0]?.command).toBe('mine');
  });

  test('uses the immediate permission hook and needs_input', () => {
    const group = mergeClaudeSettings({}, BIN).hooks?.PermissionRequest?.[0];
    expect(group?.matcher).toBe('*');
    expect(group?.hooks[0]?.command).toBe(`${BIN} notify --source claude --kind needs_input`);
  });

  test('an answered permission clears its alert: after any tool, or on the next prompt', () => {
    const hooks = mergeClaudeSettings({}, BIN).hooks;
    // Both also mark the session working, for its status line in any terminal.
    const resolve = `${BIN} notify --source claude --resolve --activity working`;
    expect(hooks?.PostToolUse).toEqual([
      { matcher: '*', hooks: [{ type: 'command', command: resolve }] },
    ]);
    expect(hooks?.UserPromptSubmit).toEqual([{ hooks: [{ type: 'command', command: resolve }] }]);
  });

  test('Stop clears attention silently unless completion alerts are requested', () => {
    expect(mergeClaudeSettings({}, BIN).hooks?.Stop?.[0]?.hooks[0]?.command).toContain('--resolve');
    expect(
      mergeClaudeSettings({}, BIN, { withStop: true }).hooks?.Stop?.[0]?.hooks[0]?.command,
    ).toContain('--kind turn_complete');
  });

  test('an existing Sirius hook gets the narrower matcher', () => {
    const old = {
      hooks: {
        Notification: [
          {
            matcher: 'permission_prompt|idle_prompt|elicitation_dialog',
            hooks: [
              {
                type: 'command' as const,
                command: `${BIN} notify --source claude --kind needs_input`,
              },
            ],
          },
        ],
      },
    };
    const groups = mergeClaudeSettings(old, BIN).hooks?.Notification ?? [];
    expect(groups).toHaveLength(1);
    expect(groups[0]?.matcher).toBe('elicitation_dialog');
  });

  test('running twice adds nothing', () => {
    const once = mergeClaudeSettings({}, BIN, { withStop: true });
    expect(mergeClaudeSettings(once, BIN, { withStop: true })).toEqual(once);
  });

  test('does not mutate its input', () => {
    const input = {};
    mergeClaudeSettings(input, BIN);
    expect(input).toEqual({});
  });
});

describe('mergeCodexConfig', () => {
  test('puts notify above the first table, where TOML needs it', () => {
    const { text, changed } = mergeCodexConfig('model = "x"\n\n[tui]\na = 1\n', BIN);
    expect(changed).toBe(true);
    expect(text.indexOf('notify')).toBeLessThan(text.indexOf('[tui]'));
    expect(text.split('\n')[0]).toBe(
      `notify = ["${BIN}", "notify", "--source", "codex", "--activity", "idle", "--from-codex-json"]`,
    );
  });

  test('running twice changes nothing', () => {
    const once = mergeCodexConfig('', BIN).text;
    expect(mergeCodexConfig(once, BIN)).toEqual({ text: once, changed: false, conflict: false });
  });

  test("never replaces someone else's notify", () => {
    const existing = 'notify = ["my-script"]\n';
    expect(mergeCodexConfig(existing, BIN)).toEqual({
      text: existing,
      changed: false,
      conflict: true,
    });
  });
});

describe('Codex hooks', () => {
  test('an approval request alerts, and carrying on clears it, without ever deciding', () => {
    const hooks = mergeCodexHooks({}, BIN).hooks;
    expect(hooks?.PermissionRequest?.[0]).toEqual({
      matcher: '*',
      hooks: [
        {
          type: 'command',
          command: `${BIN} notify --source codex --from-codex-hook`,
          async: true,
          timeout: 5,
        },
      ],
    });
    expect(hooks?.PostToolUse?.[0]?.hooks[0]?.command).toBe(
      `${BIN} notify --source codex --resolve --activity working`,
    );
    expect(hooks?.UserPromptSubmit?.[0]?.hooks[0]?.command).toBe(
      `${BIN} notify --source codex --resolve --activity working`,
    );
    expect(mergeCodexHooks(mergeCodexHooks({}, BIN), BIN)).toEqual(mergeCodexHooks({}, BIN));
  });

  test('the hook input names the folder, and reads as an approval', () => {
    const raw = JSON.stringify({ hook_event_name: 'PermissionRequest', cwd: '/home/x/teatru' });
    expect(fromCodexHook(raw)).toEqual({
      source: 'codex',
      kind: 'needs_input',
      project: 'teatru',
      message: 'Codex needs your approval',
    });
  });
});
