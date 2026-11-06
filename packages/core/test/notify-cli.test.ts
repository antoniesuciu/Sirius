import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import { createApp } from '../src/http/app.ts';
import { harness } from './harness.ts';

const cli = fileURLToPath(new URL('../../cli/src/main.ts', import.meta.url));

test('real hook CLI posts, queues, and clears attention through authenticated HTTP', async () => {
  const h = harness();
  const dir = mkdtempSync(join(tmpdir(), 'sirius-notify-'));
  writeFileSync(join(dir, 'token'), 'test-hook-token');
  const app = createApp(h.core, { token: 'test-hook-token', mode: 'local', version: 'test' });
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: app.fetch });
  const invoke = async (args: string[], payload: unknown) => {
    const proc = Bun.spawn([process.execPath, cli, 'notify', ...args], {
      env: {
        ...process.env,
        SIRIUS_DATA_DIR: dir,
        SIRIUS_TOKEN_FILE: join(dir, 'token'),
        SIRIUS_CORE_URL: server.url.origin,
      },
      stdin: new Blob([JSON.stringify(payload)]),
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 2500,
    });
    expect(await proc.exited).toBe(0);
    expect(await new Response(proc.stderr).text()).toBe('');
  };
  const permission = { hook_event_name: 'PermissionRequest', cwd: '/x/lab', tool_name: 'Bash' };
  const post = ['--source', 'claude', '--kind', 'needs_input'];
  const resolve = ['--source', 'claude', '--resolve'];
  try {
    await invoke(post, permission);
    expect(h.notified).toHaveLength(1);
    expect(h.notified[0]?.body).toContain('an approval');
    expect(h.run('get_agents', {}).agents.find((a) => a.id === 'claude')?.status).toBe('waiting');
    await invoke(resolve, { ...permission, hook_event_name: 'PostToolUseFailure' });
    expect(h.run('list_agent_events', {})).toEqual([]);

    h.advance(1000);
    h.run('set_quiet_mode', { on: true });
    await invoke(post, {
      ...permission,
      hook_event_name: 'PreToolUse',
      tool_name: 'AskUserQuestion',
    });
    expect(h.notified).toHaveLength(1);
    h.run('set_quiet_mode', { on: false });
    expect(h.notified).toHaveLength(2);
    expect(h.notified[1]?.body).toContain('has a question');
    await invoke(resolve, { ...permission, hook_event_name: 'PostToolUse' });
    expect(h.run('list_agent_events', {})).toEqual([]);

    await invoke(post, { notification_type: 'idle_prompt', cwd: '/x/lab' });
    await invoke(['--source', 'codex', '--from-codex-json', '{"type":"unknown"}'], {});
    expect(h.run('list_agent_events', {})).toEqual([]);
    expect(h.notified).toHaveLength(2);
  } finally {
    server.stop(true);
    h.core.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an unresponsive core and an open stdin cannot hang or fail the hook', async () => {
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: () => new Promise<Response>(() => {}),
  });
  const proc = Bun.spawn([process.execPath, cli, 'notify', '--source', 'claude'], {
    env: {
      ...process.env,
      SIRIUS_CORE_URL: server.url.origin,
      SIRIUS_TOKEN_FILE: '/nonexistent-token',
    },
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
    timeout: 2500,
  });
  try {
    expect(await proc.exited).toBe(0);
    expect(await new Response(proc.stderr).text()).toBe('');
  } finally {
    proc.kill();
    server.stop(true);
  }
});
