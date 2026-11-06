import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { describe, expect, test } from 'vitest';
import { LibnotifyNotifier, RateLimitedNotifier } from '../src/notifier.ts';
import { harness } from './harness.ts';

/**
 * Stand-ins for notify-send --wait and gdbus: each started notify-send prints its id and
 * lives until killed, as the real one does until GNOME closes the notification.
 */
function fakeDesktop({ extension = false, windows = ['lab'] } = {}) {
  const started: string[][] = [];
  const closed: string[] = [];
  const raised: string[][] = [];
  const alive = new Set<number>();
  const stdouts: EventEmitter[] = [];
  let next = 41;
  // The sirius-focus extension: raises a window whose title names the folder ('' = any).
  const focus = {
    available: () => extension,
    activate: async (app: string, folder: string) => {
      raised.push([app, folder]);
      return folder === '' || windows.includes(folder);
    },
  };
  /** The user clicks the nth alert: notify-send prints the action's name. */
  const click = (n: number) => stdouts[n]?.emit('data', 'default\n');
  const startNotify = (args: string[]) => {
    started.push(args);
    const id = ++next;
    alive.add(id);
    const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter; kill(): boolean };
    child.stdout = new EventEmitter();
    stdouts.push(child.stdout);
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
  return {
    started,
    closed,
    alive,
    raised,
    click,
    n: new LibnotifyNotifier(startNotify, exec, focus),
  };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('a click raises the window the agent runs in (ADR 0015)', () => {
  const alert = { key: 'codex', title: 'Sirius', body: 'Codex is waiting.' };
  const vscode = { ...alert, app: 'com.microsoft.VSCode', folder: 'lab' };

  test('with the extension, clicking raises that folder’s window, not the app’s latest', async () => {
    const { started, raised, click, n } = fakeDesktop({ extension: true });
    n.notify(vscode);
    expect(started[0]).toContain('--action=default=Open');
    await tick();
    click(0);
    await tick();
    expect(raised).toEqual([['com.microsoft.VSCode', 'lab']]);
  });

  test('no window names the folder: the app’s latest window, as before', async () => {
    const { raised, click, n } = fakeDesktop({ extension: true, windows: [] });
    n.notify(vscode);
    await tick();
    click(0);
    await tick();
    expect(raised).toEqual([
      ['com.microsoft.VSCode', 'lab'],
      ['com.microsoft.VSCode', ''],
    ]);
  });

  test('without the extension, or with nothing to raise, GNOME handles the click as before', () => {
    for (const [extension, notification] of [
      [false, vscode],
      [true, alert],
      [true, { ...alert, app: 'com.microsoft.VSCode' }],
    ] as const) {
      const { started, n } = fakeDesktop({ extension });
      n.notify(notification);
      expect(started[0]?.some((a) => a.startsWith('--action'))).toBe(false);
    }
  });

  test('an answered alert with a click action still closes by its id, raising nothing', async () => {
    const { closed, n, raised } = fakeDesktop({ extension: true });
    n.notify(vscode);
    await tick();
    n.withdraw('codex');
    expect(closed).toEqual(['42']);
    expect(raised).toEqual([]);
  });
});

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
    // The folder names the window: a click raises that one, not the app's latest (ADR 0015).
    expect(h.notified[0]?.folder).toBe('lab');
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
