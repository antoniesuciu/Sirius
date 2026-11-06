/**
 * Renders the widget, outside the app: from the laptop when it answers, otherwise from the
 * last copy the app or the background task saved, so the home screen is never empty.
 */
import { type Task, themeFrom } from '@sirius/contracts';
import * as SecureStore from 'expo-secure-store';
import { requestWidgetUpdate, type WidgetTaskHandlerProps } from 'react-native-android-widget';
import { clientFor, loadConnection } from '../connection.ts';
import { THEME_COLORS } from '../theme.gen.ts';
import { TodayWidget } from './TodayWidget.tsx';

const SNAPSHOT_KEY = 'sirius.widget';
export const WIDGET = 'Today';

interface Snapshot {
  tasks: Task[];
  theme: string;
}

async function fresh(): Promise<Snapshot | null> {
  const connection = await loadConnection();
  if (!connection) return null;
  try {
    const client = clientFor(connection);
    const [today, settings] = await Promise.all([
      client.call('get_today', {}),
      client.call('get_settings', {}),
    ]);
    const snapshot = { tasks: today.tasks, theme: themeFrom(settings) };
    // SecureStore holds about 2 KB a value, so titles are kept short.
    const small = {
      ...snapshot,
      tasks: snapshot.tasks.slice(0, 8).map((t) => ({ ...t, title: t.title.slice(0, 60) })),
    };
    await SecureStore.setItemAsync(SNAPSHOT_KEY, JSON.stringify(small)).catch(() => {});
    return snapshot;
  } catch {
    return null;
  }
}

async function saved(): Promise<Snapshot | null> {
  const raw = await SecureStore.getItemAsync(SNAPSHOT_KEY).catch(() => null);
  return raw ? (JSON.parse(raw) as Snapshot) : null;
}

function render(snapshot: Snapshot | null, away: boolean) {
  const colors =
    THEME_COLORS[(snapshot?.theme ?? 'paper') as keyof typeof THEME_COLORS] ?? THEME_COLORS.paper;
  return (
    <TodayWidget
      tasks={snapshot?.tasks ?? []}
      colors={colors}
      {...(snapshot ? (away ? { note: 'Laptop away' } : {}) : { note: 'Open Sirius to pair' })}
    />
  );
}

export async function widgetTaskHandler(props: WidgetTaskHandlerProps): Promise<void> {
  if (props.widgetAction === 'WIDGET_DELETED') return;
  if (props.widgetAction === 'WIDGET_CLICK' && props.clickAction === 'TOGGLE') {
    const { id, status } = (props.clickActionData ?? {}) as { id?: string; status?: string };
    const connection = await loadConnection();
    if (id && connection) {
      await clientFor(connection)
        .call(status === 'done' ? 'reopen_task' : 'complete_task', { id })
        .catch(() => {});
    }
  }
  const now = await fresh();
  props.renderWidget(render(now ?? (await saved()), now === null));
}

/** Called by the app and the background task after a sync. */
export function refreshWidget(): Promise<void> {
  return requestWidgetUpdate({
    widgetName: WIDGET,
    renderWidget: async () => {
      const now = await fresh();
      return render(now ?? (await saved()), now === null);
    },
  });
}
