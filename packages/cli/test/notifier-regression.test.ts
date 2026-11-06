import { describe, expect, test } from 'vitest';
import { mergeClaudeSettings, mergeCodexConfig } from '../src/hooks.ts';
import { fromClaudeHook, fromCodexJson } from '../src/notify.ts';

const BIN = '/home/x/.local/bin/sirius';

describe('prompt delivery', () => {
  test('permissions use the immediate hook; questions have their own tool hook', () => {
    const hooks = mergeClaudeSettings({}, BIN).hooks;
    expect(hooks?.PermissionRequest?.[0]?.hooks[0]?.command).toContain('--kind needs_input');
    expect(hooks?.PreToolUse?.[0]?.matcher).toBe('AskUserQuestion');
    // Delayed permission notifications must not resurrect an already answered prompt.
    expect(hooks?.Notification?.[0]?.matcher).toBe('elicitation_dialog');
  });

  test('a failed tool and a stopped turn also clear a waiting alert', () => {
    const hooks = mergeClaudeSettings({}, BIN).hooks;
    expect(hooks?.PostToolUseFailure?.[0]?.hooks[0]?.command).toContain('--resolve');
    expect(hooks?.Stop?.[0]?.hooks[0]?.command).toContain('--resolve');
    expect(
      mergeClaudeSettings({}, BIN, { withStop: true }).hooks?.Stop?.[0]?.hooks[0]?.command,
    ).toContain('--kind turn_complete');
  });

  test('payloads identify permissions and questions without copying command arguments', () => {
    const permission = fromClaudeHook(
      JSON.stringify({
        hook_event_name: 'PermissionRequest',
        cwd: '/x/lab',
        tool_name: 'Bash',
        tool_input: { command: 'private command' },
      }),
      'needs_input',
    );
    expect(permission?.message).toBe('Claude Code needs your approval');
    const question = fromClaudeHook(
      JSON.stringify({
        hook_event_name: 'PreToolUse',
        cwd: '/x/lab',
        tool_name: 'AskUserQuestion',
      }),
      'needs_input',
    );
    expect(question?.message).toBe('Claude Code has a question for you');
  });

  test('a typed permission is not discarded by the legacy idle-message heuristic', () => {
    expect(
      fromClaudeHook(
        JSON.stringify({
          notification_type: 'permission_prompt',
          message: 'Waiting for your input: approve Bash?',
        }),
        'needs_input',
      ),
    ).not.toBeNull();
  });

  test('unknown Codex notify payloads do not create false waiting alerts', () => {
    expect(fromCodexJson('{"type":"something-new","cwd":"/x/lab"}')).toBeNull();
    expect(fromCodexJson('{}')).toBeNull();
  });
});

describe('hook upgrades', () => {
  test('upgrades owned commands while preserving other hooks in the same group', () => {
    const old = mergeClaudeSettings({}, '/old/sirius');
    const mine = { type: 'command' as const, command: 'my-notifier' };
    old.hooks?.PostToolUse?.[0]?.hooks.push(mine);
    const merged = mergeClaudeSettings(old, BIN);
    const handlers = merged.hooks?.PostToolUse?.flatMap((g) => g.hooks);
    expect(handlers).toContainEqual(mine);
    expect(
      handlers?.some(
        (h) => h.command === `${BIN} notify --source claude --resolve --activity working`,
      ),
    ).toBe(true);
    expect(mergeClaudeSettings(merged, BIN)).toEqual(merged);
    expect(old.hooks?.PostToolUse?.[0]?.hooks[0]?.command).toContain('/old/sirius');
  });

  test('quotes executable paths for shell hooks and TOML', () => {
    const bin = "/home/test user's files/sirius";
    const command = mergeClaudeSettings({}, bin).hooks?.PostToolUse?.[0]?.hooks[0]?.command;
    expect(command).toBe(
      "'/home/test user'\"'\"'s files/sirius' notify --source claude --resolve --activity working",
    );
    const escaped = '/home/a"b/sirius';
    expect(
      (Bun.TOML.parse(mergeCodexConfig('', escaped).text) as { notify: string[] }).notify,
    ).toEqual([escaped, 'notify', '--source', 'codex', '--activity', 'idle', '--from-codex-json']);
  });
});

describe('Codex notify line', () => {
  test('an existing Sirius line is refreshed, so a moved binary or new flag reaches it', () => {
    const old =
      'notify = ["/old/sirius", "notify", "--source", "codex", "--from-codex-json"]\nmodel = "x"\n';
    const { text, changed, conflict } = mergeCodexConfig(old, BIN);
    expect({ changed, conflict }).toEqual({ changed: true, conflict: false });
    expect(text.split('\n')[0]).toContain(`"${BIN}"`);
    expect(text).toContain('"--activity", "idle"');
    expect(text).toContain('model = "x"');
    expect(mergeCodexConfig(text, BIN).changed).toBe(false);
  });

  test("someone else's notify is left alone", () => {
    const theirs = 'notify = ["my-notifier"]\n';
    expect(mergeCodexConfig(theirs, BIN)).toEqual({ text: theirs, changed: false, conflict: true });
  });
});
