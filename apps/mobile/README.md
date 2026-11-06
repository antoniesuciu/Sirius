# Sirius for Android

The native phone app (F41, ADR 0013). The laptop stays the server; this app pairs with it over
Tailscale, like the web phone app, and adds what a web app cannot: notifications that arrive with
the laptop off, and a home-screen widget.

## Install on the phone

1. Get `releases/sirius-android-<version>.apk` onto the phone (USB, or any file transfer).
2. Open it, and allow your file app to install apps when Android asks.
3. On the laptop run `sirius pair`. In the app, type the address it prints
   (such as `laptop.tail1234.ts.net`) and the six-digit code.
4. Allow notifications. On Today, tap **Allow on time** if it appears: without the exact-alarm
   permission Android may deliver a reminder minutes late.
5. Add the widget: long-press the home screen, Widgets, **Sirius: Today**.
6. On Honor/MagicOS: Settings, Battery, App launch, Sirius, **Manage manually**, all three on.
   Otherwise MagicOS stops the background sync (see dontkillmyapp.com/huawei).

If you turned on browser notifications in the web phone app, turn them off there, or reminders
arrive twice.

Typing `fixtures` as the address opens the app on made-up data, with no laptop.

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
bun run test:mobile        # the notification planner
cd apps/mobile && ./node_modules/.bin/expo export --platform android   # Metro bundles it
```

## How it fits

- `src/plan.ts`: which notifications the phone schedules, by the laptop Scheduler's rules.
- `src/notifications.ts`: schedules them, and turns agent alerts into local notifications.
- `src/background.ts`: resyncs every ~15 minutes, even with the app closed.
- `src/widget/`: the widget, rendered outside the app from the laptop or its last saved copy.
- `src/theme.gen.ts`: generated from the web tokens by `bun scripts/mobile-themes.ts`.
- Icons: `python3 scripts/mobile-assets.py`, from the desktop icon.

Not yet: voice, the animated logo (still for now), roadmap pages, attachments.
