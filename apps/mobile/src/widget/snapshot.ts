/** What the widget draws from: kept by the app, so the home screen works without the laptop. */
import type { ListItem, Task } from '@sirius/contracts';

export type WidgetTask = Pick<Task, 'id' | 'title' | 'status'>;
export type WidgetItem = Pick<ListItem, 'id' | 'text'>;

export interface Snapshot {
  tasks: WidgetTask[];
  list: WidgetItem[];
  theme: string;
}

/** SecureStore may refuse a value over 2048 bytes, so each saved part is kept under it. */
const ROWS = 10;
const CHARS = 50;

export function slimTasks(tasks: readonly WidgetTask[]): WidgetTask[] {
  return tasks
    .slice(0, ROWS)
    .map(({ id, title, status }) => ({ id, title: title.slice(0, CHARS), status }));
}

export function slimList(list: readonly WidgetItem[]): WidgetItem[] {
  return list.slice(0, ROWS).map(({ id, text }) => ({ id, text: text.slice(0, CHARS) }));
}

/** A tick shown at once, before the laptop has answered. */
export function toggled(snapshot: Snapshot, id: string): Snapshot {
  return {
    ...snapshot,
    tasks: snapshot.tasks.map((t) =>
      t.id === id ? { ...t, status: t.status === 'done' ? 'open' : 'done' } : t,
    ),
  };
}

/** A list item ticked off: it simply goes, as in the app. */
export const ticked = (snapshot: Snapshot, id: string): Snapshot => ({
  ...snapshot,
  list: snapshot.list.filter((i) => i.id !== id),
});

/** The font each theme's page uses (tokens.css), bundled in assets/fonts for the widget. */
export function fontsFor(theme: string): { text: string; title: string } {
  const family =
    theme === 'night-owl' ? 'Ubuntu' : theme === 'black-night' ? 'Inter' : 'Newsreader';
  return { text: `${family}-Regular`, title: `${family}-SemiBold` };
}

/**
 * Every widget draw rebuilds its images and reloads its list, which flickers, so a draw that
 * would look the same as the last one is skipped. `forget` makes the next draw happen.
 */
export function onlyChanges() {
  let shown: string | undefined;
  return {
    draw(look: unknown, paint: () => unknown): boolean {
      const key = JSON.stringify(look);
      if (key === shown) return false;
      shown = key;
      paint();
      return true;
    },
    forget() {
      shown = undefined;
    },
  };
}
