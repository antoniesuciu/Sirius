# ADR 0014: the Android app shows the web phone app, inside a native shell

Status: accepted, 2026-11-06. Replaces the native views of ADR 0013; the rest of 0013 stands.

Context: the native views of ADR 0013 had none of the web phone app's motion (the nine-state
logo, the voice orbs, the voice stage, the launch drawing) and no voice at all. The owner wants
the phone to look and move exactly like the web phone app, and to keep what the native app
added.

Decision:

- **The screen is the laptop's own web phone app**, in a WebView (`react-native-webview`). Same
  code, so the same look, animations and voice; a UI change on the laptop reaches the phone with
  no new APK.
- **The shell keeps the native work of ADR 0013**: notifications scheduled on the phone, agent
  alerts, the background sync, the Today widget, exact alarms and the paired login in the
  keystore. It keeps its own live stream for these, separate from the page's.
- **The seams are small** (`apps/mobile/src/web.ts`): the shell signs the page in with its token
  before the page's scripts run; a token the page gets by pairing again (or loses) comes back to
  the shell; a tapped notification opens its tab with the message the web service worker sends.
  Android's WebView has no `speechSynthesis`, so a stand-in passes each sentence to the phone's
  own voice (`expo-speech`) and reports when it ends. The microphone is the WebView's, as in
  Chrome, once Android grants it.
- **Launch**: the dark splash stays up until the page has painted, then the page's logo draws
  itself in, as it does in the browser.

Consequences: the phone needs the laptop to show anything but the last copy the page's service
worker kept; the widget and scheduled notifications still work without it. Fixture mode
(`fixtures`) no longer has screens, since the UI comes from the laptop. Pages served by
anything but the paired laptop open in the browser, not in the shell.
