import { describe, expect, test } from 'bun:test';
import { isAgentTool, THEMES, themeFrom } from '@sirius/contracts';
import { CLAUDE, harness } from './harness.ts';

describe('appearance (F40)', () => {
  test('an agent can switch the theme, and it is kept', () => {
    const h = harness();
    expect(h.run('set_appearance', {}, CLAUDE)).toEqual({ theme: 'paper' });
    expect(h.run('set_appearance', { theme: 'midnight' }, CLAUDE)).toEqual({ theme: 'midnight' });
    expect(h.run('get_settings', {})).toMatchObject({ 'ui.theme': 'midnight' });
  });

  test('a retired theme, such as the old Orb, falls back to the default', () => {
    expect(themeFrom({ 'ui.theme': 'orb' })).toBe('paper');
  });

  test('only the themes that exist', () => {
    const h = harness();
    // Refused by the schema, which the HTTP layer reports as invalid_input.
    expect(() => h.run('set_appearance', { theme: 'neon' as never }, CLAUDE)).toThrow();
    expect(Object.keys(THEMES)).toContain('black-night');
  });

  test('it is one of the tools agents get', () => {
    expect(isAgentTool('set_appearance')).toBe(true);
  });
});
