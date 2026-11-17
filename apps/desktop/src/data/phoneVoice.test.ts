import { afterEach, describe, expect, test } from 'bun:test';
import {
  openRecorder,
  type PhoneVoice,
  type PhoneVoiceInput,
  phoneVoiceStep,
  tapAction,
} from './browserVoice.ts';
import { createSpeaker } from './speech.ts';

const recorder = {} as MediaRecorder;
const run = (inputs: PhoneVoiceInput[], from: PhoneVoice = { kind: 'idle' }) =>
  inputs.reduce(phoneVoiceStep, from);
const reply = (turnId: string, final = false): PhoneVoiceInput => ({
  type: 'reply',
  turnId,
  final,
});

describe('phone push-to-talk', () => {
  test('a recording goes opening, recording, sending, then waits for its turn', () => {
    expect(run([{ type: 'open' }])).toEqual({ kind: 'opening' });
    expect(run([{ type: 'open' }, { type: 'opened', recorder }, { type: 'stopped' }])).toEqual({
      kind: 'sending',
    });
    expect(
      run([
        { type: 'open' },
        { type: 'opened', recorder },
        { type: 'stopped' },
        { type: 'sent', turnId: 't1' },
      ]),
    ).toEqual({ kind: 'awaitingReply', turnId: 't1' });
  });

  test('taps while the mic is opening or the recording uploads do nothing', () => {
    expect(tapAction({ kind: 'opening' })).toBeNull();
    expect(tapAction({ kind: 'sending' })).toBeNull();
    const opening = run([{ type: 'open' }]);
    expect(run([{ type: 'open' }], opening)).toBe(opening);
  });

  test('a failed mic goes back to idle', () => {
    expect(run([{ type: 'open' }, { type: 'openFailed' }])).toEqual({ kind: 'idle' });
  });

  test('a new recording drops the reply still awaited', () => {
    const awaiting: PhoneVoice = { kind: 'awaitingReply', turnId: 't1' };
    expect(tapAction(awaiting)).toBe('open');
    const opening = run([{ type: 'open' }], awaiting);
    expect(opening).toEqual({ kind: 'opening' });
    expect(run([reply('t1', true), { type: 'voiceOn' }], opening)).toEqual({ kind: 'opening' });
  });

  test('a reply for another turn is not spoken', () => {
    const awaiting: PhoneVoice = { kind: 'awaitingReply', turnId: 't2' };
    expect(run([reply('t1', true)], awaiting)).toBe(awaiting);
  });

  test('a streamed reply keeps its turn across a pause, and ends after the last part', () => {
    const speaking = run([{ type: 'voiceOn' }, reply('t1')], {
      kind: 'awaitingReply',
      turnId: 't1',
    });
    expect(speaking).toEqual({ kind: 'speaking', turnId: 't1' });
    expect(run([{ type: 'quiet' }], speaking)).toEqual({ kind: 'awaitingReply', turnId: 't1' });
    expect(run([reply('t1', true), { type: 'quiet' }], speaking)).toEqual({ kind: 'idle' });
  });

  test('a command reply speaks from idle, and a tap hushes it', () => {
    const speaking = run([{ type: 'voiceOn' }]);
    expect(speaking).toEqual({ kind: 'speaking', turnId: null });
    expect(tapAction(speaking)).toBe('hush');
    expect(run([{ type: 'hush' }], speaking)).toEqual({ kind: 'idle' });
  });
});

describe('opening the recorder', () => {
  const g = globalThis as { MediaRecorder?: unknown };
  const savedRecorder = g.MediaRecorder;
  const savedDevices = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices');
  afterEach(() => {
    g.MediaRecorder = savedRecorder;
    if (savedDevices) Object.defineProperty(navigator, 'mediaDevices', savedDevices);
    else Reflect.deleteProperty(navigator, 'mediaDevices');
  });

  // The mic tracks must stop whichever step fails after permission was granted.
  for (const failing of ['constructor', 'start'] as const) {
    test(`the mic tracks stop when the recorder's ${failing} throws`, async () => {
      let stopped = 0;
      const stream = { getTracks: () => [{ stop: () => stopped++ }] };
      Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true,
        value: { getUserMedia: async () => stream },
      });
      g.MediaRecorder = class {
        constructor() {
          if (failing === 'constructor') throw new Error('unsupported');
        }
        start() {
          throw new Error('cannot start');
        }
      };
      await expect(openRecorder()).rejects.toThrow();
      expect(stopped).toBe(1);
    });
  }
});

describe('the phone speaker', () => {
  const saved = globalThis.window;
  const savedUtterance = (globalThis as { SpeechSynthesisUtterance?: unknown })
    .SpeechSynthesisUtterance;
  afterEach(() => {
    globalThis.window = saved;
    (globalThis as { SpeechSynthesisUtterance?: unknown }).SpeechSynthesisUtterance =
      savedUtterance;
  });

  test("a cancelled utterance's late error does not end newer speech", () => {
    const spoken: { onerror: () => void; onend: () => void }[] = [];
    (globalThis as { window: unknown }).window = {
      speechSynthesis: {
        getVoices: () => [],
        speak: (u: (typeof spoken)[number]) => spoken.push(u),
        cancel: () => {},
      },
    };
    (globalThis as { SpeechSynthesisUtterance: unknown }).SpeechSynthesisUtterance = class {
      onerror = () => {};
      onend = () => {};
    };
    const states: boolean[] = [];
    const speaker = createSpeaker((on) => states.push(on));
    speaker.say('First.', 'en');
    speaker.stop();
    speaker.say('Second.', 'en');
    spoken[0]?.onerror();
    expect(states.at(-1)).toBe(true);
    spoken[1]?.onend();
    expect(states.at(-1)).toBe(false);
  });
});
