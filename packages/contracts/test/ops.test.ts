import { describe, expect, test } from 'vitest';
import { prepareRequest, readSseStream } from '../src/client.ts';
import type { SiriusEvent } from '../src/events.ts';
import { isAgentTool, isProposable, type OpDefinition, opNames, ops } from '../src/ops.ts';

describe('operation classes (spec section 7)', () => {
  test('agents cannot call anything bulk or destructive as a tool', () => {
    const exposed = opNames.filter(isAgentTool);
    expect(exposed).not.toContain('delete_goal');
    expect(exposed).not.toContain('reschedule_tasks');
    expect(exposed).not.toContain('drop_task');
  });
  test('agents cannot confirm their own proposals or undo', () => {
    const exposed = opNames.filter(isAgentTool);
    for (const name of ['confirm_proposal', 'reject_proposal', 'undo', 'send_chat'] as const) {
      expect(exposed).not.toContain(name);
    }
  });
  test('the tools the spec lists are all exposed', () => {
    const exposed = opNames.filter(isAgentTool);
    for (const name of [
      'get_today',
      'list_goals',
      'list_learning',
      'list_reminders',
      'add_task',
      'complete_task',
      'reopen_task',
      'reschedule_task',
      'add_goal',
      'add_milestone',
      'complete_milestone',
      'add_roadmap',
      'add_roadmap_step',
      'set_reminder',
      'snooze_reminder',
      'set_quiet_mode',
      'propose_changes',
    ] as const) {
      expect(exposed).toContain(name);
    }
  });
  test('every delete is bulk_or_destructive', () => {
    for (const name of opNames) {
      const def = ops[name] as OpDefinition;
      if (def.http.method === 'delete') expect(def.class).toBe('bulk_or_destructive');
    }
  });
  test('only mutating, non-plumbing operations can go inside a proposal', () => {
    expect(isProposable('reschedule_tasks')).toBe(true);
    expect(isProposable('add_task')).toBe(true);
    expect(isProposable('get_today')).toBe(false);
    expect(isProposable('propose_changes')).toBe(false);
    expect(isProposable('confirm_proposal')).toBe(false);
    expect(isProposable('nonsense')).toBe(false);
  });
});

describe('prepareRequest', () => {
  test('moves path parameters out of the body', () => {
    const req = prepareRequest(ops.reschedule_task as OpDefinition, {
      id: 'a/b',
      date: '2026-11-02',
    });
    expect(req).toEqual({
      method: 'post',
      path: '/tasks/a%2Fb/reschedule',
      body: '{"date":"2026-11-02"}',
    });
  });
  test('sends no body when nothing is left', () => {
    expect(prepareRequest(ops.complete_task as OpDefinition, { id: 'x' })).toEqual({
      method: 'post',
      path: '/tasks/x/complete',
    });
  });
  test('refuses a missing path parameter', () => {
    expect(() => prepareRequest(ops.complete_task as OpDefinition, {})).toThrow('id');
  });
});

describe('readSseStream', () => {
  function streamOf(...chunks: string[]) {
    const enc = new TextEncoder();
    return new ReadableStream<Uint8Array>({
      start(c) {
        for (const chunk of chunks) c.enqueue(enc.encode(chunk));
        c.close();
      },
    });
  }
  const done: SiriusEvent = { type: 'chat', kind: 'done', turn_id: 't' };

  test('reassembles frames split across chunks', async () => {
    const seen: SiriusEvent[] = [];
    const frame = `data: ${JSON.stringify(done)}\n\n`;
    await readSseStream(streamOf(frame.slice(0, 7), frame.slice(7)), (e) => seen.push(e));
    expect(seen).toEqual([done]);
  });
  test('skips heartbeats and malformed frames without stopping', async () => {
    const seen: SiriusEvent[] = [];
    const frame = `data: ${JSON.stringify(done)}\n\n`;
    await readSseStream(streamOf(': ping\n\n', 'data: {oops\n\n', frame), (e) => seen.push(e));
    expect(seen).toEqual([done]);
  });
});
