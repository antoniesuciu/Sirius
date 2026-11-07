/**
 * Renders the widget, outside the app: from the laptop when it answers, otherwise from the
 * last copy the app or the background task saved, so the home screen is never empty.
 */
import { themeFrom } from '@sirius/contracts';
import * as SecureStore from 'expo-secure-store';
import {
  getWidgetInfo,
  requestWidgetUpdate,
  requestWidgetUpdateById,
  type WidgetTaskHandlerProps,
} from 'react-native-android-widget';
import { clientFor, loadConnection } from '../connection.ts';
import { THEME_COLORS } from '../theme.gen.ts';
import {
  isCompact,
  onlyChanges,
  type Snapshot,
  slimList,
  slimTasks,
  ticked,
  toggled,
} from './snapshot.ts';
import { TodayWidget } from './TodayWidget.tsx';
import { WolfWidget } from './WolfWidget.tsx';

/** Tasks and theme, as before; the list on its own key, to stay under SecureStore's limit. */
const SNAPSHOT_KEY = 'sirius.widget';
const LIST_KEY = 'sirius.widget.list';
export const WIDGET = 'Today';
/** The same widget, a row shorter by default. */
const SMALL = 'TodaySmall';
const WOLF = 'Wolf';

async function fresh(): Promise<Snapshot | null> {
  const connection = await loadConnection();
  if (!connection) return null;
  try {
    const client = clientFor(connection);
    const [today, list, settings] = await Promise.all([
      client.call('get_today', {}),
      client.call('get_list', {}),
      client.call('get_settings', {}),
    ]);
    const snapshot = {
      tasks: slimTasks(today.tasks),
      list: slimList(list),
      theme: themeFrom(settings),
    };
    await Promise.all([
      SecureStore.setItemAsync(
        SNAPSHOT_KEY,
        JSON.stringify({ tasks: snapshot.tasks, theme: snapshot.theme }),
      ),
      SecureStore.setItemAsync(LIST_KEY, JSON.stringify(snapshot.list)),
    ]).catch(() => {});
    return snapshot;
  } catch {
    return null;
  }
}

async function read<T>(key: string): Promise<T | null> {
  try {
    const raw = await SecureStore.getItemAsync(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

async function saved(): Promise<Snapshot | null> {
  const [main, list] = await Promise.all([
    read<Omit<Snapshot, 'list'>>(SNAPSHOT_KEY),
    read<Snapshot['list']>(LIST_KEY),
  ]);
  return main ? { tasks: slimTasks(main.tasks), list: list ?? [], theme: main.theme } : null;
}

const colorsOf = (snapshot: Snapshot | null) =>
  THEME_COLORS[(snapshot?.theme ?? 'paper') as keyof typeof THEME_COLORS] ?? THEME_COLORS.paper;

// One per JS runtime: the app and the widget's taps share it while the app is alive.
const today = onlyChanges();

function render(snapshot: Snapshot | null, away: boolean, compact: boolean) {
  return (
    <TodayWidget
      tasks={snapshot?.tasks ?? []}
      list={snapshot?.list ?? []}
      colors={colorsOf(snapshot)}
      theme={snapshot?.theme ?? 'paper'}
      compact={compact}
      {...(snapshot ? (away ? { note: 'Laptop away' } : {}) : { note: 'Open Sirius to pair' })}
    />
  );
}

export async function widgetTaskHandler(props: WidgetTaskHandlerProps): Promise<void> {
  if (props.widgetAction === 'WIDGET_DELETED') return;
  if (props.widgetInfo.widgetName === WOLF) {
    props.renderWidget(<WolfWidget colors={colorsOf(await saved())} />);
    return;
  }
  const { widgetId, height } = props.widgetInfo;
  const compact = isCompact(height);
  const draw = (snapshot: Snapshot | null, away: boolean) =>
    today.draw(widgetId, [snapshot, away, compact], () =>
      props.renderWidget(render(snapshot, away, compact)),
    );
  const action = props.widgetAction === 'WIDGET_CLICK' ? props.clickAction : undefined;
  if (action === 'TOGGLE' || action === 'TICK_ITEM') {
    const { id, status } = (props.clickActionData ?? {}) as { id?: string; status?: string };
    const connection = await loadConnection();
    const before = await saved();
    // Tick at once from the saved copy; the laptop's answer redraws it only if it differs.
    // If the laptop is away the call fails and the saved copy, never changed, puts it back.
    if (id && before) {
      draw(action === 'TOGGLE' ? toggled(before, id) : ticked(before, id), false);
    }
    if (id && connection) {
      const client = clientFor(connection);
      await (action === 'TICK_ITEM'
        ? client.call('tick_list_item', { id })
        : client.call(status === 'done' ? 'reopen_task' : 'complete_task', { id })
      ).catch(() => {});
    }
  } else {
    // Android asked for a redraw (added, resized, the half-hourly update): always draw.
    today.forget(widgetId);
  }
  const now = await fresh();
  draw(now ?? (await saved()), now === null);
}

/** Called by the app and the background task after a sync: redraws only what changed. */
export async function refreshWidget(): Promise<void> {
  const theme = (await saved())?.theme;
  const now = await fresh();
  const snapshot = now ?? (await saved());
  const away = now === null;
  const paints: Promise<void>[] = [];
  for (const widgetName of [WIDGET, SMALL]) {
    for (const { widgetId, height } of await getWidgetInfo(widgetName).catch(() => [])) {
      const compact = isCompact(height);
      today.draw(widgetId, [snapshot, away, compact], () => {
        paints.push(
          requestWidgetUpdateById({
            widgetName,
            widgetId,
            renderWidget: () => render(snapshot, away, compact),
          }),
        );
      });
    }
  }
  await Promise.all(paints);
  if (snapshot?.theme !== theme || theme === undefined) {
    await requestWidgetUpdate({
      widgetName: WOLF,
      renderWidget: () => <WolfWidget colors={colorsOf(snapshot)} />,
    });
  }
}
