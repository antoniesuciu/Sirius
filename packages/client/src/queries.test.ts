import { expect, test } from 'vitest';
import { isPending, placeholderTask } from './queries.ts';

test('placeholder rows are flagged, and two made in one millisecond do not collide', () => {
  const a = placeholderTask('A', '2026-01-01');
  const b = placeholderTask('B', '2026-01-01');
  expect(a.pending).toBe(true);
  expect(isPending(a)).toBe(true);
  expect(a.id).not.toBe(b.id);
  expect(isPending({ id: 'stored' })).toBe(false);
});
