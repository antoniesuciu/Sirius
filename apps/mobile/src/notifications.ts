/**
 * Notifications without Firebase: the phone schedules reminders and the schedule itself, so
 * they arrive with the laptop off, and turns new agent alerts into local notifications when
 * it syncs. Nothing is sent through Google, and nothing needs an account.
 */
import { describeAgentEvent, type SiriusClient } from '@sirius/contracts';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { planNotifications } from './plan.ts';

const CHANNEL = 'sirius';
const SEEN_KEY = 'sirius.seen-events';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/** The channel must exist before Android 13 will even ask for permission. */
export async function setUpNotifications(): Promise<boolean> {
  await Notifications.setNotificationChannelAsync(CHANNEL, {
    name: 'Sirius',
    importance: Notifications.AndroidImportance.HIGH,
  });
  const { granted } = await Notifications.requestPermissionsAsync();
  return granted;
}

/** Without it Android may deliver a reminder minutes late; with it, on the minute. */
export async function exactAlarmsAllowed(): Promise<boolean> {
  try {
    return (await Notifications.getExactAlarmPermissionsAsync()).granted;
  } catch {
    return true;
  }
}

export async function allowExactAlarms(): Promise<void> {
  await Notifications.requestExactAlarmPermissionsAsync().catch(() => {});
}

/** Replaces every scheduled notification with what the laptop's data says now. */
export async function syncScheduled(client: SiriusClient): Promise<number> {
  const [reminders, schedule, today] = await Promise.all([
    client.call('list_reminders', {}),
    client.call('list_schedule', {}),
    client.call('get_today', {}),
  ]);
  const planned = planNotifications({
    reminders,
    schedule,
    now: Date.now(),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    quietToday: today.quiet_mode,
  });
  await Notifications.cancelAllScheduledNotificationsAsync();
  for (const p of planned) {
    await Notifications.scheduleNotificationAsync({
      identifier: p.id,
      content: { title: p.title, body: p.body, data: { tab: p.tab } },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: p.at,
        channelId: CHANNEL,
      },
    });
  }
  return planned.length;
}

/**
 * Agent alerts the laptop raised since the last sync: a permission prompt, a question, an
 * error. One notification per agent, replaced by a newer one and taken down once nothing is
 * waiting, like the laptop's (F25).
 */
export async function notifyAgentEvents(client: SiriusClient): Promise<void> {
  const events = await client.call('list_agent_events', {});
  const raw = await SecureStore.getItemAsync(SEEN_KEY).catch(() => null);
  const seen = raw ? new Set<string>(JSON.parse(raw) as string[]) : null;
  const waiting = events.filter((e) => e.acknowledged_at === null && e.kind !== 'turn_complete');
  for (const source of ['claude', 'codex'] as const) {
    const latest = waiting.filter((e) => e.source === source).at(-1);
    const id = `agent:${source}`;
    if (!latest) {
      await Notifications.dismissNotificationAsync(id).catch(() => {});
      continue;
    }
    // The first sync only learns what is already there, so old alerts are not replayed.
    if (!seen || seen.has(latest.id)) continue;
    await Notifications.scheduleNotificationAsync({
      identifier: id,
      content: { title: 'Sirius', body: describeAgentEvent(latest), data: { tab: 'sirius' } },
      trigger: null,
    });
  }
  const keep = events.map((e) => e.id).slice(-100);
  await SecureStore.setItemAsync(SEEN_KEY, JSON.stringify(keep)).catch(() => {});
}
