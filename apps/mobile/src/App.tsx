/**
 * Sirius for Android: the laptop stays the server (ADR 0010); this app is its native face.
 * Same four tabs as the web phone app, the same data layer (packages/client).
 */
import { ClientContext, registerQueuedOps, setReachable, useLive } from '@sirius/client';
import { greeting, type SiriusClient, type SiriusEvent } from '@sirius/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as Notifications from 'expo-notifications';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useState } from 'react';
import { AppState, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { startBackgroundSync } from './background.ts';
import { type Connection, clientFor, loadConnection, saveConnection } from './connection.ts';
import { Logo } from './Logo.tsx';
import {
  allowExactAlarms,
  exactAlarmsAllowed,
  notifyAgentEvents,
  setUpNotifications,
  syncScheduled,
} from './notifications.ts';
import { Pair } from './Pair.tsx';
import { List } from './screens/List.tsx';
import { Plan } from './screens/Plan.tsx';
import { Sirius } from './screens/Sirius.tsx';
import { Today } from './screens/Today.tsx';
import { THEME_COLORS } from './theme.gen.ts';
import { type Colors, isLight, useColors } from './theme.ts';
import { TextButton } from './ui.tsx';
import { refreshWidget } from './widget/handler.tsx';

type Tab = 'today' | 'sirius' | 'plan' | 'list';
const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'today', label: 'Today' },
  { id: 'sirius', label: 'Sirius' },
  { id: 'plan', label: 'Plan' },
  { id: 'list', label: 'List' },
];
const OWNER = 'Antonie';

export default function App() {
  const [connection, setConnection] = useState<Connection | null | undefined>(undefined);
  useEffect(() => {
    void loadConnection().then(setConnection);
  }, []);
  const colors = THEME_COLORS.paper;
  return (
    <SafeAreaProvider>
      {connection === undefined ? null : connection === null ? (
        <SafeAreaView style={[s.fill, { backgroundColor: colors.bg }]}>
          <Pair
            colors={colors}
            onPaired={(c) => {
              void saveConnection(c);
              setConnection(c);
            }}
          />
        </SafeAreaView>
      ) : (
        <Connected
          connection={connection}
          onForget={() => void saveConnection(null).then(() => setConnection(null))}
        />
      )}
    </SafeAreaProvider>
  );
}

function Connected({ connection, onForget }: { connection: Connection; onForget(): void }) {
  const client = useMemo(() => clientFor(connection), [connection]);
  const qc = useMemo(() => {
    const q = new QueryClient({
      defaultOptions: { queries: { staleTime: Number.POSITIVE_INFINITY, retry: 1 } },
    });
    registerQueuedOps(q, client);
    return q;
  }, [client]);
  return (
    <QueryClientProvider client={qc}>
      <ClientContext.Provider value={client}>
        <Main client={client} onForget={onForget} />
      </ClientContext.Provider>
    </QueryClientProvider>
  );
}

/** What to resync after an event: scheduled notifications, and the widget. */
function syncFor(event: SiriusEvent): { schedule: boolean; widget: boolean } {
  if (event.type !== 'change') return { schedule: false, widget: false };
  return {
    schedule: ['reminders', 'schedule_events', 'day_state'].includes(event.entity),
    widget: event.entity === 'tasks',
  };
}

function Main({ client, onForget }: { client: SiriusClient; onForget(): void }) {
  const colors = useColors();
  const [tab, setTab] = useState<Tab>('today');
  const [lateAlarms, setLateAlarms] = useState(false);

  const live = useLive((event) => {
    const need = syncFor(event);
    if (need.schedule) void syncScheduled(client).catch(() => {});
    if (need.widget) void refreshWidget().catch(() => {});
    if (event.type === 'agent') void notifyAgentEvents(client).catch(() => {});
  });

  // Back on screen the stream may be dead without knowing it, so reconnect and resync.
  const { reconnect } = live;
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') reconnect();
      else setReachable(false);
    });
    return () => sub.remove();
  }, [reconnect]);

  useEffect(() => {
    void (async () => {
      await setUpNotifications();
      setLateAlarms(!(await exactAlarmsAllowed()));
      await Promise.all([syncScheduled(client), notifyAgentEvents(client)]).catch(() => {});
      await refreshWidget().catch(() => {});
      await startBackgroundSync().catch(() => {});
    })();
    // A tapped notification opens the tab it is about.
    const sub = Notifications.addNotificationResponseReceivedListener((r) => {
      const asked = r.notification.request.content.data?.tab;
      if (TABS.some((t) => t.id === asked)) setTab(asked as Tab);
    });
    return () => sub.remove();
  }, [client]);

  const hour = new Date().getHours();
  return (
    <SafeAreaView style={[s.fill, { backgroundColor: colors.bg }]} edges={['top', 'left', 'right']}>
      <StatusBar style={isLight(colors.bg) ? 'dark' : 'light'} />
      <View style={s.header}>
        <Text style={[s.greeting, { color: colors.ink }]}>
          {greeting(OWNER, hour, 0).split('.')[0]}.
        </Text>
        <TextButton label="Unpair" onPress={onForget} colors={colors} />
      </View>
      {tab === 'sirius' ? (
        <View style={[s.fill, s.pad]}>
          <Sirius colors={colors} live={live} />
        </View>
      ) : (
        <ScrollView
          style={s.fill}
          contentContainerStyle={[s.pad, s.scroll]}
          keyboardShouldPersistTaps="handled"
        >
          {tab === 'today' && lateAlarms && (
            <View style={[s.offer, { borderColor: colors.lineMid }]}>
              <Text style={[s.offerText, { color: colors.ink }]}>
                Reminders may come a few minutes late.
              </Text>
              <TextButton
                label="Allow on time"
                onPress={() =>
                  void allowExactAlarms().then(async () =>
                    setLateAlarms(!(await exactAlarmsAllowed())),
                  )
                }
                colors={colors}
              />
            </View>
          )}
          {tab === 'today' && <Today colors={colors} />}
          {tab === 'plan' && <Plan colors={colors} />}
          {tab === 'list' && <List colors={colors} />}
        </ScrollView>
      )}
      <TabBar tab={tab} onTab={setTab} colors={colors} />
    </SafeAreaView>
  );
}

function TabBar({ tab, onTab, colors }: { tab: Tab; onTab(t: Tab): void; colors: Colors }) {
  const item = (t: (typeof TABS)[number]) => (
    <Pressable
      key={t.id}
      style={s.tab}
      onPress={() => onTab(t.id)}
      accessibilityRole="tab"
      accessibilityState={{ selected: tab === t.id }}
    >
      <Text style={[s.tabText, { color: colors.ink, fontWeight: tab === t.id ? '600' : '400' }]}>
        {t.label}
      </Text>
    </Pressable>
  );
  return (
    <SafeAreaView
      edges={['bottom']}
      style={[s.bar, { backgroundColor: colors.panel, borderColor: colors.panelBorder }]}
    >
      {TABS.slice(0, 2).map(item)}
      <Pressable
        style={[
          s.mark,
          {
            backgroundColor: colors.panel,
            borderColor: tab === 'sirius' ? colors.accent : colors.ink,
          },
        ]}
        onPress={() => onTab('sirius')}
        accessibilityRole="button"
        accessibilityLabel="Talk to Sirius"
      >
        <Logo size={40} colors={colors} />
      </Pressable>
      {TABS.slice(2).map(item)}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  fill: { flex: 1 },
  pad: { paddingHorizontal: 16, paddingBottom: 16 },
  scroll: { gap: 16 },
  header: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  greeting: { fontFamily: 'serif', fontSize: 28, flex: 1 },
  offer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderRadius: 16,
    padding: 12,
  },
  offerText: { flex: 1, fontFamily: 'serif', fontSize: 16 },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    borderTopWidth: 1,
    paddingTop: 6,
  },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 12 },
  tabText: { fontFamily: 'serif', fontSize: 17 },
  mark: {
    width: 60,
    height: 60,
    borderRadius: 30,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -18,
  },
});
