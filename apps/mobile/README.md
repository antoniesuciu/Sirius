# Sirius for Android

The phone app (F41, ADR 0013, ADR 0014). The laptop stays the server. The screen is the laptop's
web phone app, so it looks, moves and speaks exactly as in the browser; the native shell around
it adds what a web app cannot: notifications that arrive with the laptop off, a home-screen
widget, background sync and on-time reminders.

## Install on the phone

1. Get `releases/sirius-android-<version>.apk` onto the phone (USB, or any file transfer).
2. Open it, and allow your file app to install apps when Android asks.
3. On the laptop run `sirius pair`. In the app, type the address it prints
   (such as `laptop.tail1234.ts.net`) and the six-digit code.
4. Allow notifications, and the microphone the first time you hold to talk. Tap **Allow on
   time** if it appears: without the exact-alarm permission Android may deliver a reminder
   minutes late.
5. Add the widgets: long-press the home screen, Widgets, then **Sirius: Today** (tasks and
   things to remember; **Sirius: Today (small)** is a row shorter) and **Sirius: Talk** (the wolf, which opens Sirius listening).
6. On Honor/MagicOS: Settings, Battery, App launch, Sirius, **Manage manually**, all three on.
   Otherwise MagicOS stops the background sync (see dontkillmyapp.com/huawei).

If you turned on browser notifications in the web phone app in Chrome, turn them off there, or
reminders arrive twice.

## Build

```sh
scripts/android-build.sh   # writes releases/sirius-android-<version>.apk
```

It downloads JDK 17, the Android SDK packages and Gradle's dependencies into `.cache/` the first
time (a few GB), then builds an arm64 release APK. No account and no cloud build. For JavaScript
changes alone, `bun run --cwd apps/mobile start` serves them to a development build.

## Checks

```sh
bun run typecheck:mobile
bun run test:mobile        # the notification planner and the page bridge
cd apps/mobile && ./node_modules/.bin/expo export --platform android   # Metro bundles it
```

## How it fits

- `src/App.tsx`: the shell: the page in a WebView, and the native duties around it.
- `src/web.ts`: the seams with the page: sign-in, the token, spoken replies, notification taps.
- `src/plan.ts`: which notifications the phone schedules, by the laptop Scheduler's rules.
- `src/notifications.ts`: schedules them, and turns agent alerts into local notifications.
- `src/background.ts`: resyncs every ~15 minutes, even with the app closed.
- `src/widget/`: the widgets, rendered outside the app from the laptop or its last saved copy.
  Their fonts are in `assets/fonts/` (static instances of the page's fonts, with their licences).
- `src/theme.gen.ts`: generated from the web tokens by `bun scripts/mobile-themes.ts`.
- Launcher icon and splash: `bun scripts/mobile-icon.ts`, from the logo's paths. Notification
  icon and widget preview: `python3 scripts/mobile-assets.py`.
