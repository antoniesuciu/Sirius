/** The fields the milestone dialog edits, and the rev of the step they were read at. */
export interface Fields {
  title: string;
  description: string;
  notes: string;
}
export interface Copy extends Fields {
  rev: number;
}

const LABELS: [keyof Fields, string][] = [
  ['title', 'Milestone'],
  ['description', 'What to cover'],
  ['notes', 'Progress notes'],
];

const KEYS = LABELS.map(([key]) => key);

/**
 * What to do when the step arrives from the core again. `merge`: no field was edited on both
 * sides, so take their changes to the fields not edited here and keep the rest (this also covers
 * "nothing unsaved": every field is taken). `conflict`: a field edited here was also changed
 * there to something else, and the user chooses.
 */
export type Sync = { kind: 'same' } | { kind: 'merge'; fields: Fields } | { kind: 'conflict' };

export function sync(form: Fields, base: Copy, incoming: Copy): Sync {
  if (incoming.rev <= base.rev) return { kind: 'same' };
  const fields: Fields = { title: form.title, description: form.description, notes: form.notes };
  for (const key of KEYS) {
    const mine = form[key] !== base[key];
    const theirs = incoming[key] !== base[key];
    if (mine && theirs && form[key] !== incoming[key]) return { kind: 'conflict' };
    if (!mine) fields[key] = incoming[key];
  }
  return { kind: 'merge', fields };
}

/** The fields the other side changed, for the conflict notice. */
export function theirChanges(base: Fields, incoming: Fields): { label: string; value: string }[] {
  return LABELS.filter(([key]) => incoming[key] !== base[key]).map(([key, label]) => ({
    label,
    value: incoming[key],
  }));
}
