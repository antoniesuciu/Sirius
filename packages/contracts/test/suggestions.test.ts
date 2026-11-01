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
    expect(greeting('Antonie', 9, 0)).toBe(
      'Good morning, Antonie. Nothing is asking for you today.',
    );
    expect(greeting('Antonie', 9, 1)).toBe('Good morning, Antonie. One thing matters today.');
    expect(greeting('Antonie', 9, 7)).toBe('Good morning, Antonie. A few things matter today.');
  });
});

describe('suggestions (F3)', () => {
  test('lead with the first priority and keep rest in rotation', () => {
    const out = buildSuggestions({ ...base, openPriorities: ['Ten pages of Abbott', 'Walk'] });
    expect(out[0]).toBe('Ten pages of Abbott. Then a short walk.');
    expect(out).toContain('Take five slow breaths, then decide.');
  });
  test('include the next roadmap step with its estimate', () => {
    const out = buildSuggestions({
      ...base,
      nextStep: { title: 'sequences and limits', est_minutes: 30 },
    });
    expect(out).toContain('Sequences and limits. 30 minutes, no more.');
  });
  test('an empty day suggests rest, not work', () => {
    expect(buildSuggestions(base)[0]).toBe('Today is clear. A walk would be lovely.');
  });
  test('quiet mode never suggests work', () => {
    const out = buildSuggestions({ ...base, quiet: true, openPriorities: ['Work'] });
    expect(out.join(' ')).not.toContain('Work');
  });
  test('late evening puts rest first', () => {
    const out = buildSuggestions({ ...base, hour: 22, openPriorities: ['Work'] });
    expect(out[0]).toBe('It is late. Rest is a good answer.');
  });
});
