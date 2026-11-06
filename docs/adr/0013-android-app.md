# ADR 0013: a native Android app, with notifications and a widget, without Firebase

Status: accepted, 2026-11-06. Asked for by the owner: a native phone app with push notifications
and a widget; Android first, iPhone later; nothing that costs money.

Decision:

- **Expo (React Native) in `apps/mobile`**, on the same data layer as the web app. The queries,
  live updates, offline queue and fixtures moved to `packages/client`, so both apps use them
  unchanged. The views are rebuilt natively; the desktop stays web in Tauri. The laptop stays
  the server (ADR 0010): the app pairs through `/v1/pair` and reaches the core over Tailscale.
- **Its own install, outside the Bun workspace**, with a hoisted `node_modules`, because Gradle and
  React Native autolinking expect that layout. Metro reads the shared packages as source and
  resolves every dependency from the app's `node_modules`, so there is one React.
- **No Firebase.** Remote push on Android goes through Google's FCM, which needs the owner's Google
  account and a Firebase project. Instead:
  - reminders and schedule alerts are scheduled on the phone itself from the core's data
    (`apps/mobile/src/plan.ts`, the laptop Scheduler's rules), so they fire with the laptop off;
  - agent alerts become local notifications whenever the app syncs: live while it is open, and
    from a background task Android runs about every 15 minutes;
  - for instant alerts with the app closed, the ntfy app still works with the core.
- **A home-screen widget** (`react-native-android-widget`) shows today's tasks, ticks them off with
  a tap, and falls back to the last saved copy when the laptop is away.
- **Built locally, for free**, by `scripts/android-build.sh`: JDK 17, the Android SDK packages,
  Gradle and the APK all stay in `.cache/` and `releases/`. Signed with React Native's standard
  debug key, which installs on the owner's phone but is not for a store.

Consequences: two view layers to keep in step. A Firebase project would make agent alerts
instant with the app closed; it can be added later without changing the rest. iPhone needs the
Apple Developer Program ($99/year), a Mac or a paid cloud build, and its own Swift widget.
