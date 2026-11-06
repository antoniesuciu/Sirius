import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { describe, expect, test } from 'vitest';
import { LibnotifyNotifier, RateLimitedNotifier } from '../src/notifier.ts';
import { harness } from './harness.ts';

/**
 * Stand-ins for notify-send --wait and gdbus: each started notify-send prints its id and
 * lives until killed, as the real one does until GNOME closes the notification.
 */
function fakeDesktop() {
  const started: string[][] = [];
  const closed: string[] = [];
  const alive = new Set<number>();
  let next = 41;
  const startNotify = (args: string[]) => {
    started.push(args);
    const id = ++next;
    alive.add(id);
    const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter; kill(): boolean };
    child.stdout = new EventEmitter();
    child.kill = () => {
      alive.delete(id);
      child.emit('exit');
      return true;
    };
    queueMicrotask(() => child.stdout.emit('data', `${id}\n`));
    return child as unknown as ChildProcess;
  };
  const exec = (file: string, args: string[], done: (e: Error | null) => void) => {
    if (file === 'gdbus') closed.push(args.at(-1) ?? '');
    done(null);
  };
  return { started, closed, alive, n: new LibnotifyNotifier(startNotify, exec) };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('desktop notifications stay current (2026-11-06)', () => {
  test('each alert keeps its notify-send alive, so GNOME does not orphan it', () => {
    const { started, n } = fakeDesktop();
    n.notify({ key: 'claude', title: 'Sirius', body: 'Waiting.', app: 'com.microsoft.VSCode' });
    expect(started[0]?.slice(0, 2)).toEqual(['--wait', '--print-id']);
    expect(started[0]).toContain('--hint=string:desktop-entry:com.microsoft.VSCode');
  });

  test('a newer alert from the same source takes the shown one down first', async () => {
    const { closed, alive, n } = fakeDesktop();
    n.notify({ key: 'claude', title: 'Sirius', body: 'Claude is waiting for an approval.' });
    await tick();
    n.notify({ key: 'claude', title: 'Sirius', body: 'Claude has a question for you.' });
    n.notify({ key: 'codex', title: 'Sirius', body: 'Codex is waiting.' });
    await tick();
    expect(closed).toEqual(['42']);
    expect([...alive]).toEqual([43, 44]);
  });

  test('an answered alert is taken down, once', async () => {
    const { closed, alive, n } = fakeDesktop();
    n.notify({ key: 'claude', title: 'Sirius', body: 'Waiting.' });
    await tick();
    n.withdraw('claude');
    n.withdraw('claude');
    expect(alive.size).toBe(0);
    expect(closed).toEqual(['42']);
  });

  test('news takes itself down after a while', async () => {
    const { alive, n } = fakeDesktop();
    n.notify({ key: 'codex', title: 'Sirius', body: 'Codex finished.', expireMs: 20 });
    await tick();
    expect(alive.size).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(alive.size).toBe(0);
  });

  test('a desktop without notify-send is not an error for the core', () => {
    const n = new LibnotifyNotifier(() => {
      const child = new EventEmitter() as EventEmitter & { kill(): boolean };
      child.kill = () => true;
      queueMicrotask(() => child.emit('error', new Error('spawn notify-send ENOENT')));
      return child as unknown as ChildProcess;
    });
    expect(() => n.notify({ key: 'claude', title: 'Sirius', body: 'x' })).not.toThrow();
    expect(() => n.withdraw('claude')).not.toThrow();
  });

  test('answering ends the two-minute window, so the next prompt is announced (F25)', () => {
    const seen: string[] = [];
    let now = 0;
    const n = new RateLimitedNotifier({ notify: (x) => seen.push(x.body) }, () => now);
    n.notify({ key: 'claude', title: 'Sirius', body: 'first' });
    now = 10_000;
    n.notify({ key: 'claude', title: 'Sirius', body: 'burst' });
    n.withdraw('claude');
    n.notify({ key: 'claude', title: 'Sirius', body: 'after answering' });
    expect(seen).toEqual(['first', 'after answering']);
  });
});

describe('alerts are taken down when they stop being true', () => {
  const prompt = { source: 'claude', kind: 'needs_input', project: 'lab' } as const;

  test('answering a prompt closes its notification, and the next prompt is announced', () => {
    const h = harness();
    h.run('post_agent_event', prompt);
    h.run('resolve_agent_events', { source: 'claude', project: 'lab' });
    expect(h.withdrawn).toContain('claude');
    h.run('post_agent_event', prompt);
    expect(h.notified).toHaveLength(2);
  });

  test('Got it closes it too', () => {
    const h = harness();
    const { id } = h.run('post_agent_event', prompt);
    h.run('ack_agent_event', { id });
    expect(h.withdrawn).toContain('claude');
  });

  test('it stays while another folder of the same agent is still waiting', () => {
    const h = harness();
    h.run('post_agent_event', prompt);
    h.run('post_agent_event', { ...prompt, project: 'sirius' });
    h.run('resolve_agent_events', { source: 'claude', project: 'lab' });
    expect(h.withdrawn).not.toContain('claude');
    h.run('resolve_agent_events', { source: 'claude', project: 'sirius' });
    expect(h.withdrawn).toContain('claude');
  });

  test('a click focuses the terminal the agent runs in; "finished" goes by itself', () => {
    const h = harness();
    h.run('post_agent_event', { ...prompt, terminal: 'com.microsoft.VSCode' });
    expect(h.notified[0]?.app).toBe('com.microsoft.VSCode');
    expect(h.notified[0]?.expireMs).toBeUndefined();
    h.run('post_agent_event', { source: 'codex', kind: 'turn_complete', project: 'lab' });
    expect(h.notified[1]?.expireMs).toBe(5000);
  });

  test('a resolve with nothing waiting changes nothing', () => {
    const h = harness();
    h.run('resolve_agent_events', { source: 'claude', project: 'lab' });
    expect(h.withdrawn).toEqual([]);
  });
});
