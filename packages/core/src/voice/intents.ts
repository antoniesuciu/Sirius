/**
 * The fast path (F30): a deterministic grammar for what people say most, so those commands
 * answer like a light switch instead of waiting seconds for an agent turn. Parsing is pure;
 * voice/router.ts carries the intents out.
 *
 * Matching runs on text with diacritics folded, because Whisper is inconsistent about ș/ş and
 * ț/ţ. Captured text keeps its original spelling, so a task keeps its Romanian letters.
 */

export type Intent =
  | { kind: 'add_task'; title: string }
  | { kind: 'remind'; time: string; label: string }
  | { kind: 'whats_next' }
  | { kind: 'what_time' }
  | { kind: 'start_breathing' }
  | { kind: 'done_for_today' }
  | { kind: 'snooze' }
  | { kind: 'confirm' }
  | { kind: 'cancel' };

const FOLD: Record<string, string> = { ă: 'a', â: 'a', î: 'i', ș: 's', ş: 's', ț: 't', ţ: 't' };

/** Folds one-for-one, so indexes into the folded text are valid in the original. */
function fold(text: string): string {
  return text.toLowerCase().replace(/[ăâîșşțţ]/g, (c) => FOLD[c] ?? c);
}

const WAKE_PREFIX = /^(hey|hei|hi|ok|okay)[,\s]+sirius[,.!\s]*/i;
const TRAILING = /[\s.,!?…]+$/;

export function normalise(transcript: string): string {
  return transcript.trim().replace(WAKE_PREFIX, '').replace(TRAILING, '').trim();
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Reads "5", "5 pm", "5:30", "17:40", "5 p.m." into HH:MM. */
export function parseTime(raw: string): string | null {
  const match = raw.trim().match(/^(\d{1,2})(?:[:.](\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?$/i);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2] ?? 0);
  const meridiem = match[3]?.toLowerCase().charAt(0);
  if (meridiem === 'p' && hour < 12) hour += 12;
  if (meridiem === 'a' && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return null;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/** Whole-phrase commands, matched against folded text. */
const PHRASES: Array<[RegExp, Intent]> = [
  [
    /^(what'?s|what is) next$|^what should i do( now)?$|^ce urmeaza$|^ce am de facut$/,
    { kind: 'whats_next' },
  ],
  [
    /^what time is it$|^what'?s the time$|^cat e ceasul$|^cat este ceasul$|^ce ora e$/,
    { kind: 'what_time' },
  ],
  [
    /^(start|begin) breathing$|^let'?s breathe$|^incepe respiratia$|^sa respiram$/,
    { kind: 'start_breathing' },
  ],
  [
    /^i'?m done( for today)?$|^i am done( for today)?$|^am terminat( pe azi| pentru azi)?$/,
    { kind: 'done_for_today' },
  ],
  [/^snooze( that| it)?$|^later$|^amana( asta)?$/, { kind: 'snooze' }],
  [/^(yes|yeah|yep|confirm|do it|da|confirm[a]?|sigur)$/, { kind: 'confirm' }],
  [/^(no|nope|cancel|not now|nu|anuleaza|lasa)$/, { kind: 'cancel' }],
];

const ADD_PATTERNS: RegExp[] = [
  /^(?:add|put)\s+(.+?)\s+(?:to|on|in)\s+(?:today|my list|the list)$/,
  /^add\s+(.+)$/,
  /^(?:adauga|pune)\s+(.+?)\s+(?:la azi|pe azi|pentru azi|in lista)$/,
  /^adauga\s+(.+)$/,
];

const REMIND_PATTERNS: RegExp[] = [
  /^remind me at\s+(.+?)\s+to\s+(.+)$/,
  /^remind me to\s+(.+?)\s+at\s+(.+)$/,
  /^aminteste-mi la(?: ora)?\s+(.+?)\s+sa\s+(.+)$/,
  /^aminteste-mi sa\s+(.+?)\s+la(?: ora)?\s+(.+)$/,
];

/** Which capture group holds the time, by index into REMIND_PATTERNS. */
const TIME_GROUP = [1, 2, 1, 2];

function captureOriginal(original: string, folded: string, capture: string): string {
  const at = folded.lastIndexOf(capture);
  return at < 0 ? capture : original.slice(at, at + capture.length);
}

export function parseIntent(transcript: string): Intent | null {
  const text = normalise(transcript);
  if (!text) return null;
  const folded = fold(text);

  for (const [pattern, intent] of PHRASES) {
    if (pattern.test(folded)) return intent;
  }

  for (const [i, pattern] of REMIND_PATTERNS.entries()) {
    const match = folded.match(pattern);
    if (!match) continue;
    const timeGroup = TIME_GROUP[i] as number;
    const labelGroup = timeGroup === 1 ? 2 : 1;
    const time = parseTime(match[timeGroup] ?? '');
    if (!time) continue;
    const label = captureOriginal(text, folded, match[labelGroup] ?? '');
    return { kind: 'remind', time, label: capitalise(label) };
  }

  for (const pattern of ADD_PATTERNS) {
    const match = folded.match(pattern);
    if (match?.[1]) {
      const title = captureOriginal(text, folded, match[1]);
      return { kind: 'add_task', title: capitalise(title) };
    }
  }
  return null;
}

/** Saying only this during a session aborts it (F28). The voice service acts on it directly. */
export function isCancelWord(transcript: string): boolean {
  return /^(cancel|never mind|nevermind|anuleaza|lasa)$/.test(fold(normalise(transcript)));
}
