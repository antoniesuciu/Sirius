import { describe, expect, test } from 'vitest';
import { buildSuggestions, greeting } from '../src/suggestions.ts';

const base = { openPriorities: [], openSmalls: [], nextStep: null, quiet: false, hour: 15 };

describe('greeting (F2)', () => {
  test.each([
    [4, 'Good night, Antonie. Three things matter today.'],
    [5, 'Good morning, Antonie. Three things matter today.'],
    [12, 'Good afternoon, Antonie. Three things matter today.'],
    [18, 'Good evening, Antonie. Three things matter today.'],
  ])('at %i:00', (hour, text) => {
    expect(greeting('Antonie', hour, 3)).toBe(text);
  });
  test('uses the number of open priorities', () => {
    expect(greeting('Antonie', 9, 0)).toBe('Good morning, Antonie. Nothing planned for today.');
    expect(greeting('Antonie', 9, 0, 2)).toBe(
      'Good morning, Antonie. Something is waiting for you.',
    );
    expect(greeting('Antonie', 9, 1)).toBe('Good morning, Antonie. One thing matters today.');
    expect(greeting('Antonie', 9, 7)).toBe('Good morning, Antonie. A few things matter today.');
  });
});

describe('suggestions (F3)', () => {
  test('go through the priorities in order, then small tasks', () => {
    const out = buildSuggestions({
      ...base,
      openPriorities: ['ten pages of Abbott', 'Walk'],
      openSmalls: ['Reply to the lab'],
    });
    expect(out).toEqual(['Ten pages of Abbott.', 'Walk.', 'Reply to the lab.']);
  });
  test('include the next roadmap step with its estimate', () => {
    const out = buildSuggestions({
      ...base,
      nextStep: { title: 'sequences and limits', est_minutes: 30 },
    });
    expect(out).toContain('Sequences and limits. About 30 minutes.');
  });
  test('only suggest real work, never advice', () => {
    const out = buildSuggestions({ ...base, hour: 23, openPriorities: ['Work'] });
    expect(out).toEqual(['Work.']);
  });
  test('an empty day says so', () => {
    expect(buildSuggestions(base)).toEqual(['Today is clear.']);
  });
  test('quiet mode never suggests work', () => {
    const out = buildSuggestions({ ...base, quiet: true, openPriorities: ['Work'] });
    expect(out.join(' ')).not.toContain('Work');
  });
});
