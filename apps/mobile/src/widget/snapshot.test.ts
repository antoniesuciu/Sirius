import { describe, expect, test } from 'bun:test';
import { readdirSync } from 'node:fs';
import { THEMES } from '@sirius/contracts';
import {
  fontsFor,
  onlyChanges,
  type Snapshot,
  slimList,
  slimTasks,
  ticked,
  toggled,
} from './snapshot.ts';

const snap = (): Snapshot => ({
  theme: 'paper',
  tasks: [
    { id: 'a', title: 'a', status: 'open' },
    { id: 'b', title: 'b', status: 'done' },
  ],
  list: [
    { id: 'x', text: 'milk' },
    { id: 'y', text: 'card' },
  ],
});

describe('the widget copy', () => {
  test('a tick flips only the tapped task, both ways, and leaves the copy alone', () => {
    const before = snap();
    expect(toggled(before, 'a').tasks.map((t) => t.status)).toEqual(['done', 'done']);
    expect(toggled(before, 'b').tasks.map((t) => t.status)).toEqual(['open', 'open']);
    expect(before.tasks[0]?.status).toBe('open');
  });

  test('a list item ticked off goes', () => {
    expect(ticked(snap(), 'x').list).toEqual([{ id: 'y', text: 'card' }]);
  });

  test('the longest copy still fits SecureStore', () => {
    const id = '0190f0a2-7b1c-7c3e-9d2a-3f4b5c6d7e8f';
    const long = 'ä'.repeat(200);
    const tasks = slimTasks(
      Array.from({ length: 40 }, () => ({ id, title: long, status: 'open' as const })),
    );
    const list = slimList(Array.from({ length: 40 }, () => ({ id, text: long })));
    // Bytes, not characters: SecureStore's limit is on the stored UTF-8.
    expect(Buffer.byteLength(JSON.stringify(tasks))).toBeLessThan(2048);
    expect(Buffer.byteLength(JSON.stringify(list))).toBeLessThan(2048);
  });

  test('every theme has its fonts bundled', () => {
    const files = readdirSync(new URL('../../assets/fonts', import.meta.url));
    for (const theme of Object.keys(THEMES)) {
      const { text, title } = fontsFor(theme);
      expect(files).toContain(`${text}.ttf`);
      expect(files).toContain(`${title}.ttf`);
    }
  });
});

describe('widget draws', () => {
  test('a draw that looks the same is skipped, until forgotten', () => {
    const today = onlyChanges();
    let draws = 0;
    const paint = () => draws++;
    today.draw(1, [snap(), false], paint); // the instant tick
    today.draw(1, [snap(), false], paint); // the laptop agrees
    today.draw(1, [snap(), false], paint); // the app heard the change
    expect(draws).toBe(1);
    today.draw(1, [snap(), true], paint); // the laptop went away
    expect(draws).toBe(2);
    today.forget(1);
    today.draw(1, [snap(), true], paint);
    expect(draws).toBe(3);
  });

  test('each widget keeps its own last draw', () => {
    const today = onlyChanges();
    let draws = 0;
    today.draw(1, [snap()], () => draws++);
    today.draw(2, [snap()], () => draws++); // a second widget still gets the tick
    expect(draws).toBe(2);
  });
});
