import { describe, expect, test } from 'vitest';
import { CLAUDE, codeOf, harness } from './harness.ts';

describe('the list (F35)', () => {
  test('keeps things in the order they were added, until ticked off', () => {
    const h = harness();
    const milk = h.run('add_to_list', { text: 'Milk' });
    h.run('add_to_list', { text: 'A birthday card for Ioana' });
    h.run('tick_list_item', { id: milk.id });
    expect(h.run('get_list', {}).map((i) => i.text)).toEqual(['A birthday card for Ioana']);
  });

  test('has no day, so the 04:00 rollover leaves it alone', () => {
    const h = harness();
    h.run('add_to_list', { text: 'Milk' });
    h.advance(3 * 24 * 60 * 60 * 1000);
    h.core.scheduler.tick();
    expect(h.run('get_list', {}).map((i) => i.text)).toEqual(['Milk']);
  });

  test('an agent can add to it and tick it off, and undo brings an item back', () => {
    const h = harness();
    const item = h.run('add_to_list', { text: 'Rice' }, CLAUDE);
    h.run('tick_list_item', { id: item.id }, CLAUDE);
    const tick = h.events.findLast((e) => e.type === 'change' && e.entity === 'list_items');
    if (tick?.type !== 'change') throw new Error('no change event');
    h.run('undo', { change_id: tick.change_id });
    expect(h.run('get_list', {}).map((i) => i.text)).toEqual(['Rice']);
  });

  test('ticking something no longer there says so', () => {
    const h = harness();
    expect(codeOf(() => h.run('tick_list_item', { id: 'gone' }))).toBe('not_found');
  });
});
