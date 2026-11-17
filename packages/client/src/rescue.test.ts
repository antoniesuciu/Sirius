import { describe, expect, test } from 'bun:test';
import { holdConflicts, type SiriusClient } from '@sirius/contracts';
import { rescueConflict } from './sync.ts';

function recorder() {
  const calls: [string, unknown][] = [];
  const client = { call: async (op: string, input: unknown) => calls.push([op, input]) };
  return { calls, client: client as unknown as SiriusClient };
}

describe('a stale save whose editor is gone', () => {
  test('a note keeps its text as a new loose note', async () => {
    const { calls, client } = recorder();
    const kept = await rescueConflict(client, 'update_note', {
      id: 'n1',
      title: 'NVDA',
      body: 'Margins hold.',
      expected_rev: 3,
    });
    expect(kept).toBe(true);
    expect(calls).toEqual([
      ['add_note', { title: 'NVDA (kept from a conflict)', body: 'Margins hold.' }],
    ]);
  });

  test("a milestone's description and notes go to a note", async () => {
    const { calls, client } = recorder();
    await rescueConflict(client, 'update_roadmap_step', {
      id: 's1',
      title: 'Limits',
      description: 'Epsilon-delta.',
      notes: 'Did 2.4.',
      expected_rev: 1,
    });
    expect(calls).toEqual([
      [
        'add_note',
        { title: 'Milestone Limits (kept from a conflict)', body: 'Epsilon-delta.\n\nDid 2.4.' },
      ],
    ]);
  });

  test('a tick alone, an unguarded save, or an open editor keeps nothing', async () => {
    const { calls, client } = recorder();
    expect(
      await rescueConflict(client, 'update_roadmap_step', {
        id: 's1',
        status: 'done',
        expected_rev: 1,
      }),
    ).toBe(false);
    expect(await rescueConflict(client, 'update_note', { id: 'n1', body: 'x' })).toBe(false);
    const release = holdConflicts('n1');
    expect(
      await rescueConflict(client, 'update_note', { id: 'n1', body: 'x', expected_rev: 1 }),
    ).toBe(false);
    release();
    release(); // twice is harmless
    expect(
      await rescueConflict(client, 'update_note', { id: 'n1', body: 'x', expected_rev: 1 }),
    ).toBe(true);
    expect(calls).toHaveLength(1);
  });

  test('a long title still fits the 500-character limit', async () => {
    const { calls, client } = recorder();
    await rescueConflict(client, 'update_note', {
      id: 'n',
      title: 'a'.repeat(500),
      expected_rev: 1,
    });
    expect((calls[0]?.[1] as { title: string }).title.length).toBe(500);
  });
});
