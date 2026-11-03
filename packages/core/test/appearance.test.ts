import { describe, expect, test } from 'bun:test';
import { isAgentTool, THEMES } from '@sirius/contracts';
import { CLAUDE, harness } from './harness.ts';

describe('appearance (F40)', () => {
  test('an agent can switch the theme and the animation, and they are kept', () => {
    const h = harness();
    expect(h.run('set_appearance', {}, CLAUDE)).toEqual({ theme: 'paper', orb: 'sphere' });
    expect(h.run('set_appearance', { theme: 'midnight' }, CLAUDE)).toEqual({
      theme: 'midnight',
      orb: 'sphere',
    });
    expect(h.run('set_appearance', { orb: 'ring' }, CLAUDE)).toEqual({
      theme: 'midnight',
      orb: 'ring',
    });
    expect(h.run('get_settings', {})).toMatchObject({ 'ui.theme': 'midnight', 'ui.orb': 'ring' });
  });

  test('only the themes that exist', () => {
    const h = harness();
    // Refused by the schema, which the HTTP layer reports as invalid_input.
    expect(() => h.run('set_appearance', { theme: 'neon' as never }, CLAUDE)).toThrow();
    expect(Object.keys(THEMES)).toContain('orb');
  });

  test('it is one of the tools agents get', () => {
    expect(isAgentTool('set_appearance')).toBe(true);
  });
});
