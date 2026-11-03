/**
 * "What should I do now?" (F3): a local rule set, no AI call.
 *
 * The result is a list the header cycles through on each press. Real work comes
 * first, but well-being options are always in rotation, because rest is a valid
 * suggestion (design principles, spec section 1).
 */

export interface SuggestionInput {
  /** Titles of open priorities, in order. */
  openPriorities: string[];
  /** Titles of open small tasks, in order. */
  openSmalls: string[];
  nextStep: { title: string; est_minutes: number | null } | null;
  quiet: boolean;
  hour: number;
}

const WELLBEING = [
  'Stand up and look at something far away for a minute.',
  'Nothing urgent. A glass of water is a good plan.',
  'Take five slow breaths, then decide.',
];

function sentence(title: string): string {
  const t = title.trim().replace(/[.!]+$/, '');
  return `${t.charAt(0).toUpperCase()}${t.slice(1)}.`;
}

export function buildSuggestions(input: SuggestionInput): string[] {
  if (input.quiet) {
    return ['Nothing more today. That is the whole plan.', 'Rest is a good answer right now.'];
  }

  const out: string[] = [];
  const [first, second] = input.openPriorities;
  if (first) out.push(second ? `${sentence(first)} Then a short walk.` : sentence(first));

  if (input.nextStep) {
    const { title, est_minutes } = input.nextStep;
    out.push(
      est_minutes
        ? `${sentence(title)} ${est_minutes} minutes, no more.`
        : `${sentence(title)} One small piece of it.`,
    );
  }

  if (second) out.push(sentence(second));
  const small = input.openSmalls[0];
  if (small) out.push(sentence(small));

  if (input.hour >= 21 || input.hour < 5) out.unshift('It is late. Rest is a good answer.');
  if (!first && !small) out.push('Today is clear. A walk would be lovely.');

  return [...out, ...WELLBEING];
}

export function greetingPrefix(hour: number): string {
  if (hour < 5) return 'Good night';
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

const COUNT_WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five'];

/** F2: the typed greeting depends on the time of day and the open priorities. */
export function greeting(name: string, hour: number, openPriorities: number): string {
  const prefix = `${greetingPrefix(hour)}, ${name}.`;
  if (openPriorities === 0) return `${prefix} Nothing is asking for you today.`;
  if (openPriorities === 1) return `${prefix} One thing matters today.`;
  const word = COUNT_WORDS[openPriorities] ?? 'A few';
  return `${prefix} ${word} things matter today.`;
}
