/**
 * Sirius for Android: the laptop stays the server (ADR 0010). The screen is the web phone app,
 * served by the laptop, so it looks, moves and speaks exactly as it does in a browser
 * (ADR 0014). Around it the shell does what a browser tab cannot: notifications on the phone,
 * the Today widget, background sync and on-time reminders, all from the same data layer.
 */
import {
  ClientContext,
  registerQueuedOps,
  setReachable,
  useLive,
  useSettings,
} from '@sirius/client';
import type { SiriusClient, SiriusEvent } from '@sirius/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as Notifications from 'expo-notifications';
import * as Speech from 'expo-speech';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AppState, BackHandler, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { startBackgroundSync } from './background.ts';
import {
  type Connection,
  clientFor,
  FIXTURES,
  loadConnection,
  saveConnection,
} from './connection.ts';
import {
  allowExactAlarms,
  exactAlarmsAllowed,
  notifyAgentEvents,
  setUpNotifications,
  syncScheduled,
} from './notifications.ts';
import { Pair } from './Pair.tsx';
import { THEME_COLORS } from './theme.gen.ts';
import { isLight, useColors } from './theme.ts';
import {
  bridgeScript,
  isListenUrl,
  onLaptop,
  openTabScript,
  parseFromPage,
  RESUME_SCRIPT,
  spokenScript,
  webUrl,
} from './web.ts';
import { refreshWidget } from './widget/handler.tsx';

// The splash stays up until the page has painted, so it hands straight over to the logo
// drawing itself in. Called here, not in a component, or it can run too late.
void SplashScreen.preventAutoHideAsync().catch(() => {});
/** The splash's ground (app.json), until the page and the settings say which theme it is. */
const GROUND = '#16171A';
/** Never keep the splash up longer than this, even when the laptop is slow to answer. */
const SPLASH_MAX_MS = 5000;
/** A page that does not answer this soon after the app comes back is dead: load it again. */
const ALIVE_MS = 2000;
const TABS = ['today', 'sirius', 'plan', 'list'];

const tabOf = (response: Notifications.NotificationResponse | null): string | undefined => {
  const tab = response?.notification.request.content.data?.tab;
  return typeof tab === 'string' && TABS.includes(tab) ? tab : undefined;
};

export default function App() {
  const [connection, setConnection] = useState<Connection | null | undefined>(undefined);
  useEffect(() => {
    void loadConnection().then(setConnection);
  }, []);
  useEffect(() => {
    if (connection === null) SplashScreen.hide();
  }, [connection]);
  const save = (c: Connection | null) => {
    void saveConnection(c);
    setConnection(c);
  };
  return (
    <SafeAreaProvider>
      {connection === undefined ? null : connection === null ? (
        <SafeAreaView style={[s.fill, { backgroundColor: THEME_COLORS.graphite.bg }]}>
          <StatusBar style="light" />
          <Pair colors={THEME_COLORS.graphite} onPaired={save} />
        </SafeAreaView>
      ) : (
        <Connected key={connection.token} connection={connection} onConnection={save} />
      )}
    </SafeAreaProvider>
  );
}

function Connected({
  connection,
  onConnection,
}: {
  connection: Connection;
  onConnection(c: Connection | null): void;
}) {
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
        <Main client={client} connection={connection} onConnection={onConnection} />
      </ClientContext.Provider>
    </QueryClientProvider>
  );
}

/** What to resync after an event: scheduled notifications, and the widget. */
function syncFor(event: SiriusEvent): { schedule: boolean; widget: boolean } {
  if (event.type !== 'change') return { schedule: false, widget: false };
  return {
    schedule: ['reminders', 'schedule_events', 'day_state'].includes(event.entity),
    // What the widgets show: tasks, the list, and the theme they are drawn in.
    widget: ['tasks', 'list_items', 'settings'].includes(event.entity),
  };
}

function Main({
  client,
  connection,
  onConnection,
}: {
  client: SiriusClient;
  connection: Connection;
  onConnection(c: Connection | null): void;
}) {
  const colors = useColors();
  const themed = useSettings().data !== undefined;
  const insets = useSafeAreaInsets();
  // The typings default P to undefined, and `Props & undefined` is never: name it.
  const web = useRef<WebView<object>>(null);
  const [lateAlarms, setLateAlarms] = useState(false);
  const [failed, setFailed] = useState(false);
  // What opened the app picks the first tab: the wolf widget's link, or a notification.
  // Later taps go to the open page.
  const [source, setSource] = useState<{ uri: string } | null>(null);
  useEffect(() => {
    void Linking.getInitialURL()
      .catch(() => null)
      .then((url) => {
        const tab = isListenUrl(url)
          ? 'listen'
          : tabOf(Notifications.getLastNotificationResponse());
        setSource({ uri: webUrl(connection.address, tab) });
      });
    const sub = Linking.addEventListener('url', ({ url }) => {
      if (isListenUrl(url)) web.current?.injectJavaScript(openTabScript('listen'));
    });
    return () => sub.remove();
  }, [connection.address]);
  const bridge = useMemo(
    () => bridgeScript(connection.token, insets.bottom),
    [connection.token, insets.bottom],
  );

  const live = useLive((event) => {
    const need = syncFor(event);
    if (need.schedule) void syncScheduled(client).catch(() => {});
    if (need.widget) void refreshWidget().catch(() => {});
    // A new alert, or an answered one (its row changes), so the notification follows.
    if (event.type === 'agent' || (event.type === 'change' && event.entity === 'agent_events')) {
      void notifyAgentEvents(client).catch(() => {});
    }
  });

  // Back on screen the stream may be dead without knowing it, so reconnect and resync.
  // Android may have killed the page's renderer while away, which leaves a blank screen.
  const { reconnect } = live;
  const unanswered = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        reconnect();
        clearTimeout(unanswered.current);
        unanswered.current = setTimeout(() => web.current?.reload(), ALIVE_MS);
        web.current?.injectJavaScript(RESUME_SCRIPT);
      } else setReachable(false);
    });
    return () => {
      sub.remove();
      clearTimeout(unanswered.current);
    };
  }, [reconnect]);

  useEffect(() => {
    void (async () => {
      await setUpNotifications();
      setLateAlarms(!(await exactAlarmsAllowed()));
      await Promise.all([syncScheduled(client), notifyAgentEvents(client)]).catch(() => {});
      await refreshWidget().catch(() => {});
      await startBackgroundSync().catch(() => {});
    })();
    const sub = Notifications.addNotificationResponseReceivedListener((r) => {
      const tab = tabOf(r);
      if (tab) web.current?.injectJavaScript(openTabScript(tab));
    });
    const giveUp = setTimeout(() => SplashScreen.hide(), SPLASH_MAX_MS);
    return () => {
      sub.remove();
      clearTimeout(giveUp);
    };
  }, [client]);

  const canGoBack = useRef(false);
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!canGoBack.current) return false;
      web.current?.goBack();
      return true;
    });
    return () => sub.remove();
  }, []);

  const onMessage = (event: WebViewMessageEvent) => {
    const m = parseFromPage(event.nativeEvent.data);
    if (!m) return;
    if (m.type === 'alive') {
      clearTimeout(unanswered.current);
    } else if (m.type === 'speak') {
      const answer = (ok: boolean) => web.current?.injectJavaScript(spokenScript(m.id, ok));
      Speech.speak(m.text, {
        ...(m.lang ? { language: m.lang } : {}),
        onDone: () => answer(true),
        onStopped: () => answer(false),
        onError: () => answer(false),
      });
    } else if (m.type === 'cancel') {
      void Speech.stop();
    } else if (m.token === null) {
      // The laptop no longer knows this phone: pair again, natively, for the shell as well.
      onConnection(null);
    } else if (m.token !== connection.token) {
      onConnection({ ...connection, token: m.token });
    }
  };

  // Until the settings arrive, the splash's ground, so no other theme flashes past.
  const ground = themed ? colors.bg : GROUND;
  if (connection.address === FIXTURES) {
    return (
      <View style={[s.fill, s.centre, { backgroundColor: ground }]}>
        <Text style={[s.message, { color: colors.ink }]}>
          The phone app is the laptop's page. Pair with a laptop to use it.
        </Text>
        <TextLink label="Pair" onPress={() => onConnection(null)} color={colors.accent} />
      </View>
    );
  }
  return (
    <View style={[s.fill, { backgroundColor: ground, paddingTop: insets.top }]}>
      <StatusBar style={isLight(ground) ? 'dark' : 'light'} />
      {lateAlarms && (
        <View style={[s.offer, { borderColor: colors.lineMid }]}>
          <Text style={[s.offerText, { color: colors.ink }]}>
            Reminders may come a few minutes late.
          </Text>
          <TextLink
            label="Allow on time"
            color={colors.accent}
            onPress={() =>
              void allowExactAlarms().then(async () => setLateAlarms(!(await exactAlarmsAllowed())))
            }
          />
          <TextLink label="Not now" color={colors.muted} onPress={() => setLateAlarms(false)} />
        </View>
      )}
      {failed ? (
        <View style={[s.fill, s.centre]}>
          <Text style={[s.message, { color: colors.ink }]}>
            I can't reach the laptop just now. Is it awake and on Tailscale?
          </Text>
          <TextLink
            label="Try again"
            color={colors.accent}
            onPress={() => {
              setFailed(false);
              web.current?.reload();
            }}
          />
        </View>
      ) : null}
      {source && (
        <WebView<object>
          ref={web}
          source={source}
          style={[s.fill, { backgroundColor: ground }, failed && s.hidden]}
          injectedJavaScriptBeforeContentLoaded={bridge}
          onMessage={onMessage}
          onLoadEnd={() => SplashScreen.hide()}
          onRenderProcessGone={() => web.current?.reload()}
          onError={() => {
            setFailed(true);
            SplashScreen.hide();
          }}
          onNavigationStateChange={(nav) => {
            canGoBack.current = nav.canGoBack;
          }}
          // Links away from the laptop open in the browser, not over the app.
          onShouldStartLoadWithRequest={(request) => {
            if (onLaptop(request.url, connection.address) || request.url.startsWith('about:')) {
              return true;
            }
            void Linking.openURL(request.url);
            return false;
          }}
          // The OS asks for the microphone once; then push-to-talk works as in Chrome.
          mediaCapturePermissionGrantType="grant"
          mediaPlaybackRequiresUserAction={false}
          allowsInlineMediaPlayback
          domStorageEnabled
          setSupportMultipleWindows={false}
          overScrollMode="never"
          webviewDebuggingEnabled={__DEV__}
        />
      )}
    </View>
  );
}

function TextLink({ label, color, onPress }: { label: string; color: string; onPress(): void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" hitSlop={8}>
      <Text style={[s.link, { color }]}>{label}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  fill: { flex: 1 },
  hidden: { display: 'none' },
  centre: { alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 },
  message: { fontFamily: 'serif', fontSize: 18, textAlign: 'center' },
  link: { fontFamily: 'serif', fontSize: 16, fontWeight: '600' },
  offer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderBottomWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  offerText: { flex: 1, fontFamily: 'serif', fontSize: 15 },
});
