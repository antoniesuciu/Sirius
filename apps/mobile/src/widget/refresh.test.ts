/**
 * The widget's refresh and the background task, end to end over stubbed native modules and a
 * stubbed fetch: the real handler, connection, client and notifications code runs.
 */
import { beforeEach, expect, mock, test } from 'bun:test';

const store = new Map<string, string>();
const paints: { widgetId: number; render: () => { props: { note?: string; tasks: unknown[] } } }[] =
  [];
let rejectPaints = 0;
let widgets: { widgetId: number; height: number }[] = [];
let tasks: unknown[] = [];
let failPath: { path: string; status: number | 'network' } | null = null;
let task: () => Promise<number>;

mock.module('expo-secure-store', () => ({
  getItemAsync: async (k: string) => store.get(k) ?? null,
  setItemAsync: async (k: string, v: string) => void store.set(k, v),
  deleteItemAsync: async (k: string) => void store.delete(k),
}));
const widget = () => null;
mock.module('react-native-android-widget', () => ({
  FlexWidget: widget,
  ListWidget: widget,
  SvgWidget: widget,
  TextWidget: widget,
  getWidgetInfo: async (name: string) => (name === 'Today' ? widgets : []),
  requestWidgetUpdate: async () => {},
  requestWidgetUpdateById: async (p: { widgetId: number; renderWidget: () => never }) => {
    paints.push({ widgetId: p.widgetId, render: p.renderWidget });
    if (rejectPaints-- > 0) throw new Error('paint failed');
  },
}));
mock.module('expo-task-manager', () => ({
  defineTask: (_: string, fn: () => Promise<number>) => {
    task = fn;
  },
  isTaskRegisteredAsync: async () => true,
}));
mock.module('expo-background-task', () => ({
  BackgroundTaskResult: { Success: 1, Failed: 2 },
  BackgroundTaskStatus: { Available: 2 },
  getStatusAsync: async () => 2,
  registerTaskAsync: async () => {},
}));
mock.module('expo-notifications', () => ({
  setNotificationHandler: () => {},
  cancelAllScheduledNotificationsAsync: async () => {},
  scheduleNotificationAsync: async () => '',
  dismissNotificationAsync: async () => {},
  SchedulableTriggerInputTypes: { DATE: 'date' },
}));

const bodies: Record<string, unknown> = {
  '/v1/today': { tasks: [], quiet_mode: false },
  '/v1/list': [],
  '/v1/settings': {},
  '/v1/reminders': [],
  '/v1/schedule': [],
  '/v1/agent-events': [],
};
globalThis.fetch = (async (url: string) => {
  const path = new URL(url).pathname;
  if (failPath && path === failPath.path) {
    if (failPath.status === 'network') throw new TypeError('network request failed');
    return new Response(JSON.stringify({ code: 'unauthorized', message: 'no' }), {
      status: failPath.status,
    });
  }
  const body = path === '/v1/today' ? { tasks, quiet_mode: false } : bodies[path];
  return new Response(JSON.stringify(body));
}) as unknown as typeof fetch;

const { refreshWidget } = await import('./handler.tsx');
const { BackgroundTaskResult } = await import('expo-background-task');
await import('../background.ts');

const last = () => paints.at(-1)?.render().props;

beforeEach(() => {
  store.clear();
  store.set('sirius.connection', JSON.stringify({ address: 'https://laptop.test', token: 't' }));
  paints.length = 0;
  rejectPaints = 0;
  failPath = null;
  tasks = [{ id: 'a', title: 'a', status: 'open' }];
});

test('a rejected paint is retried by the next identical refresh, then skipped once it landed', async () => {
  widgets = [{ widgetId: 11, height: 300 }];
  rejectPaints = 1;
  await refreshWidget();
  expect(paints.length).toBe(1);
  await refreshWidget(); // same look, but the first paint never landed
  expect(paints.length).toBe(2);
  await refreshWidget(); // landed: skipped
  expect(paints.length).toBe(2);
});

test('a 401 says to pair and an unreachable laptop says away, both over the saved rows', async () => {
  widgets = [{ widgetId: 12, height: 300 }];
  await refreshWidget();
  expect(last()?.note).toBeUndefined();

  failPath = { path: '/v1/today', status: 'network' };
  await refreshWidget();
  expect(last()?.note).toBe('Laptop away');
  expect(last()?.tasks.length).toBe(1);

  failPath = { path: '/v1/today', status: 401 };
  await refreshWidget();
  expect(last()?.note).toBe('Open Sirius to pair');
  expect(last()?.tasks.length).toBe(1);
});

test('the background task still refreshes the widget when a sync throws, and reports Failed', async () => {
  widgets = [{ widgetId: 13, height: 300 }];
  failPath = { path: '/v1/reminders', status: 'network' };
  expect(await task()).toBe(BackgroundTaskResult.Failed);
  expect(paints.some((p) => p.widgetId === 13)).toBe(true);
});

test('the background task succeeds when nothing fails', async () => {
  widgets = [{ widgetId: 14, height: 300 }];
  expect(await task()).toBe(BackgroundTaskResult.Success);
});
