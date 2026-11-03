/**
 * Says replies on the phone with Android's own voice (F38). The laptop's voice service never
 * speaks a turn the phone started, so without this a spoken question gets a silent answer.
 */

/** Whisper's language code to a BCP 47 tag the phone has a voice for. */
export function speechTag(lang: string): string {
  return lang.toLowerCase().startsWith('ro') ? 'ro-RO' : 'en-US';
}

/** Markdown reads badly aloud: "asterisk asterisk". */
export function forSpeech(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[*_`#>]+/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Splits streamed text into whole sentences, so speaking can start before the reply ends. A
 * full stop counts only before a space, so "3.5" and "e.g." mid-word stay whole.
 */
export function takeSentences(buffer: string): { sentences: string[]; rest: string } {
  const sentences: string[] = [];
  let rest = buffer;
  for (;;) {
    const match = rest.match(/^([\s\S]*?[.!?…])\s+/);
    if (!match?.[1]) break;
    sentences.push(match[1]);
    rest = rest.slice(match[0].length);
  }
  return { sentences, rest };
}

export interface Speaker {
  say(text: string, lang: string): void;
  /** Feeds a streamed reply; `final` says whatever is left. */
  stream(delta: string, lang: string, final: boolean): void;
  stop(): void;
}

export function speechSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

export function createSpeaker(onSpeaking: (speaking: boolean) => void): Speaker {
  let buffer = '';
  let queued = 0;
  const synth = speechSupported() ? window.speechSynthesis : null;

  const settle = () => {
    queued = Math.max(0, queued - 1);
    if (queued === 0) onSpeaking(false);
  };

  const utter = (raw: string, lang: string) => {
    const text = forSpeech(raw);
    if (!synth || !text) return;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = speechTag(lang);
    // Without a matching voice the phone reads Romanian with an English one.
    const voice = synth.getVoices().find((v) => v.lang.replace('_', '-') === utterance.lang);
    if (voice) utterance.voice = voice;
    utterance.onend = settle;
    utterance.onerror = settle;
    queued += 1;
    onSpeaking(true);
    synth.speak(utterance);
  };

  return {
    say: utter,
    stream(delta, lang, final) {
      buffer += delta;
      const { sentences, rest } = takeSentences(buffer);
      buffer = rest;
      for (const sentence of sentences) utter(sentence, lang);
      if (final) {
        utter(buffer, lang);
        buffer = '';
      }
    },
    stop() {
      buffer = '';
      queued = 0;
      synth?.cancel();
      onSpeaking(false);
    },
  };
}
