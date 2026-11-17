<div align="center">

<img src="docs/design/sirius.svg" alt="Sirius logo" width="96">

# Sirius

A personal dashboard and assistant for the day, on Ubuntu and Android.

![Bun](https://img.shields.io/badge/Bun-1.4%2B-000?logo=bun&logoColor=white)
![Platform](https://img.shields.io/badge/Ubuntu%2024.04%20%C2%B7%20Android-E95420?logo=ubuntu&logoColor=white)
![Agents](https://img.shields.io/badge/agents-Claude%20Code%20%C2%B7%20Codex-D97757)
![Self-hosted](https://img.shields.io/badge/runs%20on-your%20laptop-2E7D32)

<img src="docs/screenshots/dashboard.png" alt="The Sirius dashboard on a laptop, after asking Sirius to add a goal" width="900">

</div>

Sirius opens at login on Ubuntu and shows what matters today, a few goals, a learning path,
personal reminders and a short list of things to remember. The assistant in it runs the official
**Claude Code** and **Codex** command-line tools on your own subscriptions. It also tells you
when one of those agents, running elsewhere on the machine, is waiting for you. Speech
recognition and speech synthesis run on the laptop. A paired Android phone shows the same
dashboard over a private Tailscale link, in Chrome or in the Sirius Android app, and keeps
working from its own copy while the laptop is away.

> [!NOTE]
> Sirius has no account and no cloud backend of its own. The core listens only on `127.0.0.1`,
> voice stays on the laptop, and agents run through your own Claude Code and Codex logins, so
> chat turns spend your subscription quota. Agents can only use the `sirius` tools: no files,
> no shell, no browsing.

## Contents

[Features](#-features) · [Quick start](#-quick-start) · [How to use it](#-how-to-use-it) ·
[Configuration and themes](#%EF%B8%8F-configuration-and-themes) · [Phone](#-phone) ·
[Android app](#-the-android-app) · [GNOME extension](#%EF%B8%8F-the-gnome-extension) ·
[How it works](#-how-it-works) · [Privacy and safety](#-privacy-and-safety) ·
[Data](#-where-your-data-lives) · [Project layout](#%EF%B8%8F-project-layout) ·
[Verify](#-verify) · [Status](#-status-and-known-limits) · [What's next](#-whats-next) ·
[How it was built](#-how-it-was-built) · [Documentation](#-documentation)

## ✨ Features

| | |
|---|---|
| 💬 **Sirius** | A chat with Claude or Codex, switched with one tap, through the official CLIs. One conversation lasts until you start a new one, and carries over when you switch agents. Pick Claude's model, or one of four Codex presets, each with its own reasoning effort. A memory file keeps lasting facts across sessions. |
| ☀️ **Today** | Two or three priorities plus small tasks. Unfinished tasks move quietly to the next day at 04:00. When only small things are left, the greeting says so: "Something is waiting for you." |
| 📅 **Schedule** | Fixed commitments such as lectures, the gym or shifts: weekly on chosen days within a term, or once. Kept apart from tasks, with a reminder 10 minutes before. Sirius can add them, and your phone's calendar can show them. |
| 🎯 **Goals** | A few goals, with milestone dots instead of percentages. "A step closer" marks today as a day you worked on the goal, without adding a milestone. Add goals by hand or ask Sirius. |
| 🧭 **Learning** | Independent roadmaps, each with milestones and its own page of checkpoints, descriptions and progress notes. Attach a syllabus PDF or Markdown file in the chat, and Sirius turns it into a roadmap. |
| 📝 **To remember** | A plain list for things to buy or remember, with no day or time attached. |
| 🗒️ **Notes** | Notes of any length, loose or in folders such as "Stocks". They save as you type, and Sirius can write or edit them. |
| 🧘 **Personal and Well-being** | Prayer and reflection reminders, a breathing exercise and stretch nudges. |
| 🔔 **Agent attention** | A toast and a desktop notification when Claude Code or Codex, in any terminal, is blocked on a permission prompt or a question. It clears itself once you answer. Clicking it brings up the terminal or VS Code the agent runs in, also from a distrobox container. The Sirius card shows which sessions are working or idle. |
| 🎙️ **Voice** | Push-to-talk with **Ctrl+Alt+Space**, in English and Romanian. Common commands such as "add milk to my list" or "ce urmează" are handled on the laptop without an agent turn; anything else goes to the agent. |
| 🎨 **Looks** | Seven themes; ask Sirius to switch. The Sirius wolf takes each theme's colours and reacts: it draws itself in at launch, listens, thinks and speaks with the voice, works while an agent runs, howls when one finishes or wants you, and sleeps in quiet mode. |
| 📱 **Phone** | An installable web app over Tailscale with its own layout: Today, Sirius, Plan and List behind a bottom bar. It keeps an offline copy, opens from it within about three seconds when the laptop does not answer, queues the changes you make while away, and sends each one exactly once when the laptop is back. |
| 🤖 **Android app** | The same phone app in a native shell, which adds reminders scheduled on the phone (they fire with the laptop off), agent alerts, home-screen widgets and background sync. No Google account, no Firebase, built locally for free. |

Any card except the chat folds to its title bar with a click on its title. Each device remembers
which cards are folded.

Agents never change several things at once, or delete anything, without you confirming a
proposal card. Single changes an agent makes can be undone for 30 seconds.

## 🚀 Quick start

You need Ubuntu 24.04 with GNOME 46 on Wayland (the only desktop tested),
[Bun](https://bun.sh) 1.4 or later, Rust with the
[Tauri 2 prerequisites](https://v2.tauri.app/start/prerequisites/),
[uv](https://docs.astral.sh/uv/) with Python 3.12 for voice, and `claude` and/or `codex`
installed and logged in. An NVIDIA GPU makes speech recognition several times faster, but voice
also works on the CPU. [Tailscale](https://tailscale.com) (the free personal plan) is needed only
for the phone.

```bash
git clone <this repository> sirius && cd sirius
scripts/deploy.sh --with-mcp --with-voice --with-desktop
sudo apt install --reinstall ./apps/desktop/src-tauri/target/release/bundle/deb/Sirius_0.1.0_amd64.deb
sirius setup-hooks --apply      # agent alerts; your settings are backed up first
sirius doctor                   # checks every part
```

- `deploy.sh` reads `deployment.env`, builds everything, and installs the core and voice as
  systemd user services. `--with-mcp` registers `sirius-mcp` with Claude Code and Codex. The
  voice step downloads about 3 GB of models once.
- `setup-hooks` makes Claude Code and Codex tell Sirius when they need you: a permission prompt,
  a question or an approval. Codex asks you to trust new hooks once: open `/hooks` in Codex and
  approve the Sirius ones.
- Add `--with-focus` to raise the agent's own window rather than the app's latest one. See
  [the GNOME extension](#%EF%B8%8F-the-gnome-extension).

> [!IMPORTANT]
> To update, run the same two install commands again. The `--reinstall` matters: every build is
> version 0.1.0, and apt would otherwise skip it. If Sirius is open, restart it with
> `pkill -x sirius-desktop`, then open it from the launcher.

To try the UI without installing anything:

```bash
bun install
bun run dev                  # core with live reload, plus the Vite dev server
# then open http://localhost:5173/?fixtures for the UI on built-in demo data, no core needed
```

## 🧭 How to use it

1. **Log in.** Sirius opens with the session and greets you with what matters today.
2. **Plan the day** in **Today**: type into **Add a task**, or ask Sirius ("add water the basil
   to today"). Tick tasks as you finish them. Stuck? Press **What should I do now?**
3. **Talk to Sirius** in the chat card. Pick **Claude** or **Codex**, choose a model under the
   switch, and type into **Ask Sirius**, press the mic, or press **Ctrl+Alt+Space** from
   anywhere. **New conversation** starts over. Bulk changes and deletes show up as a
   proposal card for you to confirm.
4. **Follow a roadmap.** Open one from **Learning**, pick a milestone, then **Put it in Today**
   to turn it into a task. Ticking that task logs a day worked on the step and leaves the step
   open until you press **Mark complete**. Keep **Progress notes** and **Save notes** as you go.
5. **Jot things down** in **To remember** ("Milk, a birthday card…") or **Notes**; **Open notes**
   shows every folder.
6. **Answer agents.** When Claude Code or Codex in another terminal waits for you, a banner
   appears. Click it to jump to that terminal or VS Code window.
7. **Wrap up** with **I'm done for today**. Unfinished tasks move to tomorrow at 04:00.

<div align="center">
<img src="docs/screenshots/roadmap.png" alt="A learning roadmap: milestones on a path, with the selected milestone's notes" width="900">
</div>

Some things you can say: "add milk to my list", "remind me at five to call mum", "what's next",
"I'm done for today", "start breathing", "adaugă cumpără orez la azi", "pune lapte pe listă",
"ce urmează".

| Command | What it does |
|---|---|
| `Ctrl+Alt+Space` | Talk to Sirius. Press again to stop listening, or to interrupt a reply. |
| `sirius doctor` | Check the core, the agents, notifications and voice. |
| `sirius voice on` / `off` | Turn voice on, or off and stop its service. |
| `sirius pair` / `forget-phones` | Pair a phone, or sign all of them out. |
| `sirius calendar` | Print the schedule's calendar feed address, for ICSx⁵ on Android. |
| `sirius backup` | Take a snapshot of the database now. One is also taken every night. |
| `sirius setup-hooks [--apply]` | Show, or apply, the Claude Code and Codex hook changes. |

## ⚙️ Configuration and themes

Everything is in `deployment.env`, a tracked file you edit by hand. After changing it, run
`scripts/deploy.sh` again. Secrets never go in it; the remote setup keeps them in the
git-ignored `infra/.env`.

| Setting | Default | Meaning |
|---|---|---|
| `SIRIUS_TARGET` | `local` | `local` keeps everything on this laptop. `remote` runs the core in Docker; see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). |
| `SIRIUS_MEMORY_FILE` | inside the Obsidian vault | The Markdown file Sirius remembers in. You can read and edit it. |
| `SIRIUS_VOICE_EN` / `SIRIUS_VOICE_RO` | `en_US-lessac-medium` / `ro_RO-mihai-medium` | Any [Piper voice](https://rhasspy.github.io/piper-samples/) name, or a direct link to a voice's `.onnx` file. |
| `SIRIUS_VOICE_PACE` | `1.0` | Above 1 speaks more slowly. |
| `SIRIUS_NTFY_URL` | empty | An [ntfy](https://ntfy.sh) topic, for agent alerts and reminders on the phone. The public server sees the text, so use a long random topic, or host ntfy yourself. |

Themes have no settings screen: ask Sirius ("switch to graphite", "something darker", "the blue
one"), and the desktop, the phone and the widgets follow.

<div align="center">
<img src="docs/screenshots/black-night.png" alt="The dashboard in the Black Night theme" width="900">
</div>

| Theme | Looks | Type |
|---|---|---|
| **Paper** | Warm cream with an olive accent. The original. | Newsreader (serif) |
| **Midnight Blue** | Deep blue-black with a strong blue accent. | Newsreader |
| **Night Owl** | VS Code's Night Owl palette. | Ubuntu |
| **Graphite** | Neutral dark grey with a gold accent. | Newsreader |
| **Sage** | Light green-grey paper with a deep green accent. | Newsreader |
| **Ember** | Near-black warm brown with an orange glow. | Newsreader |
| **Black Night** | Pure black with a blue-to-orange gradient. | Inter (sans) |

The themes are CSS tokens in `packages/ui/src/styles/tokens.css`; `scripts/mobile-themes.ts`
turns them into the Android app's colours, so there is one source for both.

## 📱 Phone

1. Install Tailscale on the laptop and the phone, and sign in to the same account on both.
2. In the Tailscale admin console, under **DNS**, turn on **MagicDNS** and **HTTPS Certificates**.
3. On the laptop, run `sudo tailscale set --operator=$USER` once.
4. Run `sirius pair`. It sets up `tailscale serve` if needed and prints a link and a six-digit
   code. Install `qrencode` to get a QR code as well.
5. Open the link in Chrome on the phone, then choose **Install app** from Chrome's menu.

<p align="center">
  <img src="docs/images/phone-sirius.png" alt="The phone's Sirius tab after adding a goal" width="30%">
  &nbsp;
  <img src="docs/images/phone-plan.png" alt="The phone's Plan tab with goals and roadmaps" width="30%">
</p>

The code works once, for five minutes. `sirius forget-phones` signs out every paired phone. The
phone picks up new versions by itself after each install. Its mic sends your voice to the laptop,
stops by itself once you go quiet, and says the answer on the phone.

For notifications, tap **Turn on** at the top of Today and allow them. Reminders, schedule alerts
and agent alerts then arrive as ordinary Android notifications through Chrome. Each one is
encrypted on the laptop for that phone, so the push service in between cannot read it. They come
from the laptop, so it has to be awake.

For the schedule in your phone's own calendar, with its widget and alarms that ring with the
laptop off, run `sirius calendar` and subscribe to the address it prints with
[ICSx⁵](https://icsx5.bitfire.at/), a free, open-source Android app.

## 🤖 The Android app

Instead of installing the page from Chrome, you can use the Sirius app. Its screen is the same web
phone app, served by the laptop, so a UI change reaches the phone with no new APK. Around it, the
app schedules reminders and schedule alerts on the phone itself, so they ring with the laptop off,
turns agent alerts into notifications, refreshes in the background about every 15 minutes, and
adds three home-screen widgets:

- **Sirius: Today**: today's tasks, then the things to remember, in one list that scrolls. Tap a
  task to tick or untick it and an item to tick it off; the tick shows at once and the laptop's
  answer confirms it. Tap the wolf to talk, or the title to open the app without the microphone.
- **Sirius: Today (small)**: the same, a row shorter. Any Today widget resized to about two rows
  tightens its header so more of the list shows.
- **Sirius: Talk**: just the wolf, one cell and resizable. A tap opens Sirius already listening.

They open the app through the `sirius://listen` link. The widgets show the laptop's data when it
answers and the last saved copy when it does not, marked "Laptop away"; a tick made while the
laptop is away is put back rather than queued. Home-screen widgets cannot animate, so the wolf
there is still. If the app's page ever goes blank after the phone has been away, the app reloads
it by itself.

```bash
scripts/android-build.sh    # writes releases/sirius-android-<version>.apk
```

The first build downloads JDK 17, the Android SDK and Gradle's dependencies into `.cache/` (a few
GB). Copy the APK to the phone, install it, and pair with `sirius pair`, typing the address and
code into the app. The full steps, including the battery setting MagicOS needs, are in
[apps/mobile/README.md](apps/mobile/README.md); the reasoning is in ADR 0013 and 0014.

> [!WARNING]
> If browser notifications are on in Chrome too, turn them off there, or reminders arrive twice.

## 🖥️ The GNOME extension

You have three VS Code windows open and a Codex session in `ros2_ws` stops to ask for approval.
Clicking the alert brings up **that** window, the one with `ros2_ws` in it, even if the session
runs inside a distrobox container and even if you used another VS Code window last.

On Wayland, no ordinary program may raise another program's window. GNOME only lets an alert
activate an *app*, which then shows whichever of its windows was used last. Only code inside
GNOME Shell can pick one window, so Sirius ships `apps/gnome-extension/sirius-focus@sirius`,
51 lines of JavaScript:

```
 agent waits ──► sirius notify ──► sirius-core ──► alert with a click action
                                                         │ you click
                                                         ▼
          GNOME Shell ◄── D-Bus: org.sirius.Focus.Activate("code", "ros2_ws")
          raises the most recently used VS Code window whose title names ros2_ws
```

- **One method, which can only focus.** Any program on your session bus could call it, so it
  reads nothing out: no window list, no titles, just "found" or "not found".
- **Exact folder matching.** `ws` does not match `ros2_ws`, and `Documents` does not match a
  terminal at `~/Documents/sirius` (`names.js`, with tests). It works with VS Code's titles and
  GNOME Terminal's `user@host:~/path` titles.
- **Nothing breaks without it.** The core adds the click action only when the extension answers;
  otherwise alerts raise the app's latest window.

Install it with `scripts/install.sh --with-focus`, then log out and in once, since GNOME loads new
extensions at login. To try it by hand:

```bash
gdbus call --session --dest org.gnome.Shell --object-path /org/sirius/Focus \
  --method org.sirius.Focus.Activate code sirius
```

The reasoning is in ADR 0015. It targets GNOME Shell 46, the version on Ubuntu 24.04.

## 🔧 How it works

```
 ┌───────────────┐   ┌──────────────────┐   ┌──────────────────┐
 │ Desktop app   │   │ Phone (PWA)      │   │ Claude Code /    │
 │ Tauri + React │   │ over Tailscale   │   │ Codex anywhere   │
 └──────┬────────┘   └───────┬──────────┘   └──────┬───────────┘
        │ REST + SSE         │ HTTPS               │ hooks: sirius notify
        ▼                    ▼                     ▼
 ┌─────────────────────────────────────────────────────────────┐
 │ sirius-core   Bun · Hono · SQLite (WAL) · 127.0.0.1:7337    │
 │ the only writer: ops, scheduler, proposals, undo, memory    │
 └──────┬──────────────────────────────┬───────────────────────┘
        │ spawns, one turn at a time   │ events
        ▼                              ▼
 ┌──────────────────────────┐   ┌───────────────────────────────┐
 │ claude -p / codex exec   │   │ sirius-voice (Python)         │
 │ tools: sirius-mcp only   │   │ Silero VAD · faster-whisper   │
 └──────────────────────────┘   │ Piper TTS · PipeWire          │
                                └───────────────────────────────┘
```

- **One source of truth.** Every operation is declared once in
  `packages/contracts/src/ops.ts`. The REST routes, the OpenAPI document, the typed client and
  the MCP tools are all derived from it.
- **The core owns time.** The 04:00 rollover, reminders and backups run in the core, so they keep
  working with the window closed to the tray.
- **All up or all down.** Quitting the app stops the core, and stopping the core closes the app.
  With a phone paired, the laptop keeps serving it instead. See ADR 0009.

## 🔒 Privacy and safety

- **Agents are fenced in.** Both CLIs run with their built-in tools switched off and only the
  `sirius` MCP server available, so they cannot read files, run commands or browse. A canary
  check in `bench/agents.ts` proves this against the real CLIs. Agents can propose bulk changes
  and deletes, but never apply them without your confirmation, and they are limited to five
  edits a minute.
- **Voice stays on the laptop.** Audio is processed in memory and never written to disk. The
  microphone is a process that exists only while you are speaking.
- **No telemetry.** Model downloads happen at install time, and at runtime the voice service runs
  with Hugging Face offline and onnxruntime's telemetry switched off.
- **The phone link is private.** The core listens only on `127.0.0.1`, and Tailscale carries it
  to your own devices. A phone holds its own token, stored on the laptop only as a hash.

## 💾 Where your data lives

| Path | Contents |
|---|---|
| `~/.local/share/sirius/sirius.sqlite` | Everything on the dashboard, plus the chat |
| `~/.local/share/sirius/backups/` | Nightly snapshots |
| `~/.local/share/sirius/token` | The local API token, readable only by you |
| `~/.local/share/sirius/{models,voices,voice-venv}` | Speech models and the voice environment |
| `~/.config/sirius/` | Paths and settings written by the installer |
| `SIRIUS_MEMORY_FILE` | What Sirius remembers about you |

## 🗂️ Project layout

```
apps/desktop        Tauri shell and the React app (also served to the phone)
apps/mobile         The Android app: a native shell around the phone page (Expo, own install)
apps/gnome-extension  The sirius-focus GNOME Shell extension
packages/client     Data layer shared by both apps: queries, live updates, offline queue, fixtures
packages/contracts  Op registry, schemas, typed client, 04:00 calendar logic
packages/core       The service: store, ops, scheduler, chat, HTTP, phones
packages/mcp        The stdio MCP server agents use
packages/cli        The `sirius` command
packages/ui         Presentational components and styles
services/voice      Push-to-talk voice service (Python)
infra               systemd units, Docker and compose for remote mode
docs                Requirements, decision records, deployment guide
```

Database changes go through Drizzle: edit `packages/core/src/db/schema.ts`, then run
`bun run db:generate`.

## ✅ Verify

| Command | Runs |
|---|---|
| `bun run test` | Unit and integration tests for the core, contracts, MCP server and CLI (`bun test`) |
| `bun run test:e2e` | Playwright on desktop, phone, a real local core, a remote-mode core and a paired phone |
| `bun run typecheck` / `bun run lint` | TypeScript 7 strict / Biome |
| `bun run test:mobile` / `bun run typecheck:mobile` | The Android app's notification planner and page bridge / its types |
| `cd services/voice && uv run pytest` | Voice service tests |
| `cd apps/desktop/src-tauri && cargo test` | Desktop shell tests |
| `bun bench/agents.ts` | The real Claude and Codex flows plus the isolation canary. This spends subscription quota. |

## 🚧 Status and known limits

v1 covers milestones M0 to M6, plus the phone. It is in daily use on one laptop and one Android
phone.

> [!WARNING]
> - **Memory:** the desktop app uses about 294 MB against a 200 MB target, because of WebKitGTK.
>   ADR 0004 explains why Tauri stays.
> - **Android app:** built on the laptop and signed with React Native's debug key, so it installs
>   by hand, not from a store. Its screen needs the laptop (or the page's last cached copy). Agent
>   alerts with the app closed arrive at the next background sync, up to about 15 minutes late,
>   unless ntfy is set up. Widget ticks are not queued while the laptop is away. No iPhone app
>   yet: it needs the paid Apple Developer Program.
> - **Remote mode** (Docker, Cloudflare, ntfy) is built and tested locally, but has never been
>   deployed. The container also has no agent CLIs.
> - **Wake word:** not built yet.

## 🔭 What's next

In rough order:

1. **Wake word.** "Hey Sirius" on the laptop, so you can talk without the shortcut (M9 in
   [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md)). Listening for it must stay within the idle
   budget of ADR 0004. It also means a microphone that is always open, so the promise under
   [Privacy and safety](#-privacy-and-safety) changes from "only while you speak" to "audio
   stays in memory on the laptop".
2. **Your own voices.** Voices are fixed in `deployment.env` at install. Next: a voice setting at
   runtime, an upload from the app, and the voice service reloading it without a reinstall.
3. **Instant phone alerts with the app closed.** Today they wait for the next background sync. A
   self-hosted ntfy server would make them instant with no Google services and no cost.
4. **iPhone.** The Expo app is written to work on iOS, but installing it needs the Apple Developer
   Program ($99 a year) and a Mac or a cloud build. Not planned until that is worth paying for.

## 🛠️ How it was built

Sirius was written by its owner with AI coding agents, the same two it runs: **Claude Code** and
**Codex**, working one at a time on the repository. A few tools made that work across many
sessions:

- **[Matt Pocock's agent skills](https://github.com/mattpocock/skills)**: reusable instructions
  for test-driven development, diagnosing hard bugs, domain modelling and ADRs, code review and
  writing for agents. They keep each change small, tested and recorded.
- **[claude-mem](https://github.com/thedotmack/claude-mem)**: memory across Claude Code sessions.
  It records what each session found and decided, so the next one can search it instead of
  rediscovering it. Its recall is treated as a hint and checked against the code.
- **An Obsidian vault** shared by both agents: a project overview, the current state and the
  architecture decisions, kept short and linking to the repository's own documents, which stay
  the source of truth.
- **This repository's own records**: `docs/REQUIREMENTS.md`, the ADRs in `docs/adr/` and
  `AGENTS.md` files, so either agent can pick up where the other stopped.

## 📚 Documentation

- [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md): the full specification and milestones
- [docs/adr/](docs/adr/): decision records, each with its reasoning
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md): local or deployed, moving data, restoring backups
- [docs/verified.md](docs/verified.md): vendor facts checked against current tools
- [CHANGELOG.md](CHANGELOG.md): what changed, milestone by milestone

---

<sub>The screenshots use the app's built-in demo data (`?fixtures`), not a real day. The phone
screenshots are retaken with `bun run build:ui && SIRIUS_README_SHOTS=1 bunx playwright test readme-shots`.</sub>
