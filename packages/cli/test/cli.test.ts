import { describe, expect, test } from 'vitest';
import { mergeClaudeSettings, mergeCodexConfig } from '../src/hooks.ts';
import { fromClaudeHook, fromCodexJson } from '../src/notify.ts';

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

  test('uses the documented matcher and needs_input', () => {
    const group = mergeClaudeSettings({}, BIN).hooks?.Notification?.[0];
    expect(group?.matcher).toContain('permission_prompt');
    expect(group?.matcher).not.toContain('idle_prompt');
    expect(group?.hooks[0]?.command).toBe(`${BIN} notify --source claude --kind needs_input`);
  });

  test('the Stop hook is off unless asked for', () => {
    expect(mergeClaudeSettings({}, BIN).hooks?.Stop).toBeUndefined();
    expect(mergeClaudeSettings({}, BIN, { withStop: true }).hooks?.Stop?.length).toBe(1);
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
    expect(groups[0]?.matcher).toBe('permission_prompt|elicitation_dialog');
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
      `notify = ["${BIN}", "notify", "--source", "codex", "--from-codex-json"]`,
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
