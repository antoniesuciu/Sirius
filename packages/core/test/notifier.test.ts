import { describe, expect, test } from 'vitest';
import { LibnotifyNotifier, RateLimitedNotifier } from '../src/notifier.ts';
import { harness } from './harness.ts';

/** A stand-in for execFile: records each command and answers notify-send with an id. */
function fakeExec() {
  const calls: Array<{ file: string; args: string[] }> = [];
  let next = 41;
  const exec = (file: string, args: string[], done: (e: Error | null, out: string) => void) => {
    calls.push({ file, args });
    done(null, file === 'notify-send' ? `${++next}\n` : '');
  };
  return { calls, exec };
}

describe('desktop notifications stay current (2026-11-06)', () => {
  test('a newer alert from the same source replaces the shown one in place', () => {
    const { calls, exec } = fakeExec();
    const n = new LibnotifyNotifier(exec);
    n.notify({ key: 'claude', title: 'Sirius', body: 'Claude is waiting for an approval.' });
    n.notify({ key: 'claude', title: 'Sirius', body: 'Claude has a question for you.' });
    n.notify({ key: 'codex', title: 'Sirius', body: 'Codex is waiting.' });
    expect(calls[0]?.args).toContain('--print-id');
    expect(calls[0]?.args.some((a) => a.startsWith('--replace-id'))).toBe(false);
    expect(calls[1]?.args).toContain('--replace-id=42');
    expect(calls[2]?.args.some((a) => a.startsWith('--replace-id'))).toBe(false);
  });

  test('an answered alert is closed, once', () => {
    const { calls, exec } = fakeExec();
    const n = new LibnotifyNotifier(exec);
    n.notify({ key: 'claude', title: 'Sirius', body: 'Waiting.' });
    n.withdraw('claude');
    n.withdraw('claude');
    const closes = calls.filter((c) => c.file === 'gdbus');
    expect(closes).toHaveLength(1);
    expect(closes[0]?.args).toContain('org.freedesktop.Notifications.CloseNotification');
    expect(closes[0]?.args.at(-1)).toBe('42');
    // Withdrawn, so the next alert is a fresh notification rather than a replacement.
    n.notify({ key: 'claude', title: 'Sirius', body: 'Waiting again.' });
    expect(calls.at(-1)?.args.some((a) => a.startsWith('--replace-id'))).toBe(false);
  });

  test('a desktop without a notification daemon is not an error for the core', () => {
    const n = new LibnotifyNotifier((_f, _a, done) => done(new Error('no daemon'), ''));
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

  test('a resolve with nothing waiting changes nothing', () => {
    const h = harness();
    h.run('resolve_agent_events', { source: 'claude', project: 'lab' });
    expect(h.withdrawn).toEqual([]);
  });
});
