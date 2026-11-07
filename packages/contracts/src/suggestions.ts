/**
 * "What should I do now?" (F3): a local rule set, no AI call.
 *
 * The result is a list the header cycles through on each press: priorities first, then the
 * next learning step, then small tasks. Only real work from the dashboard, no advice.
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

function sentence(title: string): string {
  const t = title.trim().replace(/[.!]+$/, '');
  return `${t.charAt(0).toUpperCase()}${t.slice(1)}.`;
}

export function buildSuggestions(input: SuggestionInput): string[] {
  if (input.quiet) return ['Nothing left today. Quiet mode is on.'];

  const out = input.openPriorities.map(sentence);
  if (input.nextStep) {
    const { title, est_minutes } = input.nextStep;
    out.push(est_minutes ? `${sentence(title)} About ${est_minutes} minutes.` : sentence(title));
  }
  out.push(...input.openSmalls.map(sentence));
  return out.length > 0 ? out : ['Today is clear.'];
}

export function greetingPrefix(hour: number): string {
  if (hour < 5) return 'Good night';
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

const COUNT_WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five'];

/** F2: the typed greeting depends on the time of day and the open priorities. */
export function greeting(
  name: string,
  hour: number,
  openPriorities: number,
  openTasks = 0,
): string {
  const prefix = `${greetingPrefix(hour)}, ${name}.`;
  if (openPriorities === 0) {
    return `${prefix} ${openTasks > 0 ? 'Something is waiting for you.' : 'Nothing planned for today.'}`;
  }
  if (openPriorities === 1) return `${prefix} One thing matters today.`;
  const word = COUNT_WORDS[openPriorities] ?? 'A few';
  return `${prefix} ${word} things matter today.`;
}
