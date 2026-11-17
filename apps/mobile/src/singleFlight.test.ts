import { describe, expect, test } from 'bun:test';
import { singleFlight } from './singleFlight.ts';

const gate = () => {
  let open!: () => void;
  const opened = new Promise<void>((r) => {
    open = r;
  });
  return { open, opened };
};

describe('singleFlight', () => {
  test('calls during a run share one more run, with the latest arguments', async () => {
    const started: string[] = [];
    const gates = [gate(), gate()];
    const sync = singleFlight(async (tag: string) => {
      started.push(tag);
      await gates[started.length - 1]?.opened;
      return tag;
    });
    const first = sync('a');
    const b = sync('b');
    const c = sync('c');
    await Promise.resolve();
    expect(started).toEqual(['a']); // nothing overlaps the running one
    gates[0]?.open();
    expect(await first).toBe('a');
    await Bun.sleep(0);
    expect(started).toEqual(['a', 'c']); // one re-run, with the newest arguments
    gates[1]?.open();
    expect(await Promise.all([b, c])).toEqual(['c', 'c']);
    expect(await sync('d')).toBe('d'); // idle again: runs at once
  });

  test('a failed run does not block the re-run, and rejects only its own callers', async () => {
    let n = 0;
    const g = gate();
    const sync = singleFlight(async () => {
      n++;
      if (n === 1) {
        await g.opened;
        throw new Error('laptop away');
      }
      return n;
    });
    const first = sync();
    const second = sync();
    g.open();
    await expect(first).rejects.toThrow('laptop away');
    expect(await second).toBe(2);
  });
});
