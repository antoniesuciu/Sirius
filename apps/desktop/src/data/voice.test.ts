import { describe, expect, test } from 'bun:test';
import { quietAfterSpeech } from './browserVoice.ts';

describe('the phone mic stops by itself (F28)', () => {
  test('1.5 s of quiet after speaking ends it', () => {
    const done = quietAfterSpeech();
    expect(done(0.4, 0)).toBe(false);
    expect(done(0.02, 100)).toBe(false);
    expect(done(0.02, 1500)).toBe(false);
    expect(done(0.02, 1600)).toBe(true);
  });

  test('silence before speaking never ends it', () => {
    const done = quietAfterSpeech();
    expect(done(0.01, 0)).toBe(false);
    expect(done(0.01, 10_000)).toBe(false);
  });

  test('speaking again restarts the quiet', () => {
    const done = quietAfterSpeech();
    done(0.4, 0);
    done(0.02, 100);
    done(0.4, 1000);
    expect(done(0.02, 1100)).toBe(false);
    expect(done(0.02, 2500)).toBe(false);
    expect(done(0.02, 2600)).toBe(true);
  });
});
