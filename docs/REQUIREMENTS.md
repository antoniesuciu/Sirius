# Sirius: Requirements

Status: v1.5 spec, 2026-11-02 (one conversation with shared memory, see `docs/adr/0008-one-thread-shared-memory.md`; laptop only for now; M7 and M8 are built but not deployed; the wake word moves to M9, Special additions; `deployment.env` chooses local or deployed; see `docs/adr/0006-laptop-only.md` and `0007-deployment-switch.md`). Owner: Antonie.
Design references: `design/dashboard-reference.dc.html` (interactive mockup; its avatar `<img src="/_blob/…">` points to `design/sirius.svg`) and `design/sirius.svg` (final avatar).

> **Success criterion.** Opening the computer should make the day feel clearer and less chaotic. It should not create another project to manage.

---

## 0. Instructions for the implementing agent

- Read this whole document before writing code. Section 5 (architecture decisions) is binding. Change a decision only with a short ADR in `docs/adr/` that explains why.
- `design/dashboard-reference.dc.html` is a **reference mockup**, written in a proprietary component format (`<x-dc>`, `<sc-if>`, `<sc-for>`, `renderVals()`). Do **not** port that runtime. Re-implement the layout, copy, colors, animations and interactions in React. Take the CSS keyframes and SVG markup almost as-is.
- `design/sirius.svg` is the production avatar. Turn it into a React component whose `state` prop is `idle | listening | thinking | speaking | asleep` (see F15a). It is a traced, layered version of a free stock wolf icon with custom eyes. The file is grouped by class:
  - `ruff`, `body`, `shade`, `light`, `earin`, `nose`, `noseb`, `line` (the navy outline, drawn on top);
  - `eyes`: the sclera, with an `iris` group per eye clipped by `#sirius-eyes`. This is what animates.
  Ears and jaw are **not** separate parts, so the head-level states use whole-image transforms (bob, tilt, scale) plus eye animation (blink = scaleY on `.eyes`, glance = translate on `.iris`). Inline the SVG; don't use `<img>`, so CSS can reach the classes. It's about 150 KB, so it's worth one more optimisation pass.
- Work milestone by milestone (section 12). Each milestone ends with its acceptance criteria passing in CI and a short entry in `CHANGELOG.md`.
- Anything marked **[verify]** is a CLI flag or vendor detail that may have changed. Check the current docs or `--help` before relying on it, and record what you found in `docs/verified.md`.

---

## 1. Product summary

Sirius is a small, single-screen desktop dashboard and personal assistant for Ubuntu. It opens automatically at login. It holds:

| Section | Purpose |
|---|---|
| **Header** | Date, live clock (HH:MM, system time), typed greeting, "What should I do now?", "I'm done for today" |
| **Today** | 2–3 priorities plus optional small tasks, and quick add |
| **Goals** | A few medium- and long-term goals with milestone dots (no percentages or streaks) |
| **Learning** | Roadmaps (e.g. real analysis → probability → stochastic processes → stochastic calculus), shown as an animated path |
| **Personal** | Prayer and reflection reminders |
| **Well-being** | Breathing exercise, next gentle nudge |
| **Sirius** | Embedded assistant chat with a wolf avatar. Runs Claude Code or Codex headlessly, on the user's subscriptions |
| **Agent attention** | Quiet toast and notification when Claude or Codex (running elsewhere on the machine) needs input |
| **Voice** | Push-to-talk, personal-assistant-style requests. Speech recognition and synthesis run locally. "Hey Sirius" comes later (M9) |

**Design principles** (from the original notes, all binding): calm over productivity metrics; minimal over feature-rich; personal over prescriptive; quiet by default; local-first; no obligation to optimize every minute; rest is a valid suggestion.

**Amended 2026-11-03 by the owner (ADR 0011):** Sirius is a direct personal assistant, not a calming presence. Its voice drops reassurance, rest advice and filler. **2026-11-04 design amendment:** remove falling leaves; keep breathing. Explore a simple canine-and-Sirius-star logo (`docs/design/logos/`), with **Orbit (the wolf/star/arc concept) selected by the owner** for application icons after reviewing Ascent. Launcher icons have a transparent background. The dashboard keeps the original theme-aware voice orb in every state, with a higher-resolution canvas. Desktop “To remember” sits below Sirius; Well-being moves to the right column. Roadmap overview cards are compact; full details stay on the dedicated roadmap page.

## 2. Scope

**v1 (milestones M0–M6):** the desktop app on Ubuntu, local core service, MCP server, Sirius chat via Claude/Codex CLIs, agent-attention notifications, local push-to-talk voice.

**Later:** M9, Special additions, including the "Hey Sirius" wake word. M7 (core on a homelab) is built and tested locally but not deployed, because there is no homelab yet. The phone works without one: it uses the laptop's own core over Tailscale and keeps an offline copy (ADR 0010). `deployment.env` is the switch between local and deployed.

**Non-goals:** multi-user, accounts, sharing, calendar sync, analytics, streaks, scores, gamification, a plugin system, Windows/macOS packaging (it shouldn't be prevented, just not done).

## 3. Functional requirements

### 3.1 Header
- **F1** Date label "Sunday · 1 November" and clock "15:45" come from the system clock and time zone. The clock sits **inline before the date, at the top of the header's left column**, at 44px with tabular numerals. Do not put it in a separate column that can wrap under the greeting; that rendered badly on resize. The clock re-renders on the minute boundary with a self-rescheduling `setTimeout`, not a 1 s interval. It re-syncs on `visibilitychange` and on system resume.
- **F2** The greeting depends on time of day: night before 05, morning before 12, afternoon before 18, evening after. It types out once per launch. The typed text comes from the number of open priorities.
- **F3** "What should I do now?" types out one short suggestion. Suggestions come from a local rule set (open priorities, next roadmap step, well-being options such as walk, water, breathe or rest) and cycle on each press. No AI call is needed.
- **F4** "I'm done for today" enables quiet mode until 04:00 the next day:
  - nonessential reminders stop;
  - the Today and Goals panels dim;
  - Sirius sleeps;
  - agent toasts are suppressed and queued.
  "Welcome back" undoes it.

### 3.2 Today
- **F5** Tasks have a tier (`priority` or `small`), a scheduled date and a status. Today shows open and done tasks for today. Priorities come first, then a "Small things, if there's room" group.
- **F6** Quick add needs no AI. It creates a `small` task for today and shows the sprout "Planted in Today" micro-animation. The UI updates optimistically and gives visual feedback within 50 ms.
- **F7** Clicking a task toggles done. Done tasks are struck through and stay visible until the end of the day.
- **F8** The day rolls over at 04:00 local time. Unfinished tasks are not shown as "overdue". They move silently to the new day; the user can drop them.

### 3.3 Goals
- **F9** Each goal has a title, an optional horizon or target date, and ordered milestones. Progress is shown as dots, filled per milestone done; up to 5 visible, then the latest 5.
- **F10** Goals, milestones, learning roadmaps and steps are created primarily **through Sirius** or an external Claude Code/Codex session via MCP. Goals have inline rename/delete and a one-line add field (F34). The roadmap page also supports adding and editing learning milestones, descriptions and progress notes (2026-11-04 owner amendment).

### 3.4 Learning
- **F11** Roadmaps are independent routes, each shown in its own overview card. Selecting one opens a full-page explorer at `?roadmap=<id>`, with a winding route, selectable checkpoint nodes, completed markers and a highlighted current/selected checkpoint. The first unfinished milestone marks "You are here". Finishing one roadmap never starts another. Browser Back returns to the dashboard (2026-11-04 owner amendment).
- **F12** Each ordered milestone keeps its title, optional time estimate, description, progress notes, completion state and completion date. The explorer supports adding milestones, editing details, saving notes, completing and reopening milestones. "Put it in Today" creates a linked task; task completion/reopening updates its milestone. Completing/reopening in the explorer updates linked tasks too. Notes live in SQLite and use the existing operation/phone queue infrastructure.

### 3.5 Personal and Well-being
- **F13** Reminders have a label, a kind (`prayer | wellbeing | custom`), a schedule (time plus weekdays) and an enabled flag. Each one can be snoozed. They fire as quiet native notifications (section 3.7).
- **F14** The breathing exercise is a circle that scales over an 8 s cycle (4 s in, 4 s out), with a live "Breathe in / out" label. Start and stop are manual.

### 3.6 Sirius (assistant)
- **F15** The chat panel shows the avatar, a status line (listening, thinking it over, asleep), an agent switch (**Claude | Codex**), the active model, message history, suggestion chips, an input, and a **mic button** (F27).
- **F15a** Avatar states:
  - `idle`: slow bob, a blink every ~6.5 s, slow side-to-side glances of the iris;
  - `listening`: a slight scale-up (1.03), eyes centred, a faint pulse ring behind the head;
  - `thinking`: head tilt of ±4°, irises glancing up;
  - `speaking`: a subtle vertical squash or bob synced to TTS amplitude, coarse at about 10 Hz;
  - `asleep`: the eyes group collapsed (scaleY ≈ 0.08), head lowered 2 px, dimmed to 85 %.
  State transitions crossfade in 200–300 ms. Transform and opacity only.
- **F16** Defaults: Claude with model **Haiku 5.5**; Codex with model **"6.1 Sol Light"** (the user's name for it; resolve the exact model ID **[verify]**). Both are configurable in settings. The selected agent persists.
- **F17** Requests run headlessly through the official CLI (section 8). Text streams into the chat bubble. The typewriter effect is driven by the real stream, smoothed to at most ~60 chars/s.
- **F18** Sirius changes data **only through Sirius MCP tools** (section 7). It never edits files or runs shell commands.
- **F19** Additive single operations apply immediately: add a task, goal, milestone, roadmap, step or reminder. An operation that modifies or deletes more than one existing item, or deletes anything, becomes a **proposal**. The UI shows a Confirm / Not now card, and only Confirm applies it. The core enforces this, not the prompt.
- **F20** Every agent-applied change is recorded in the change log and can be undone with one click ("Undo") for 30 s after it applies.
- **F21** There is one conversation until "New conversation" clears it, and it stays when the agent changes. Follow-ups resume the CLI session, which is replaced on a switch and after 20 turns, because a long session costs more usage. A new session gets the end of the thread and the memory file (ADR 0008). The agent-available `remember` tool adds to that file, which survives "New conversation".
- **F22** If the CLI is missing, not logged in, or out of quota, Sirius says so in one plain sentence and suggests the fix (`claude login`, etc.). The rest of the dashboard is unaffected.

### 3.7 Agent attention and notifications
- **F23** Claude Code hooks and Codex `notify` (section 9) post events to the core. The UI shows a toast ("Claude Code is waiting for an approval in the quant-lab folder.") with **Got it / Later**, and the agent status line updates. The toast clears itself once the session carries on: a `PostToolUse` or `UserPromptSubmit` hook means the prompt was answered.
- **F24** The core sends native desktop notifications (libnotify) for reminders and agent attention, so they work when the window is closed to the tray, but not after a real Quit, which stops the core too (ADR 0009). Quiet mode suppresses them; agent events queue and appear on "Welcome back".
- **F25** Rate limits: at most one notification per source per 2 minutes, and duplicate events are coalesced.

### 3.8 Voice
- **F26** *(deferred to M9)* **Wake word** "Hey Sirius" starts listening, hands-free, whether or not the window is open. In v1, listening starts from push-to-talk (F27); the earcon, the `listening` avatar and the live transcript line apply to that.
- **F27** **Push-to-talk**, the way to start voice in v1:
  - the mic button in the chat;
  - a system keyboard shortcut, registered as a GNOME custom shortcut that runs `sirius voice ptt`. Ubuntu's default Wayland session doesn't reliably allow app-level global hotkeys, so the shortcut is set at the system level.
- **F28** End of speech is detected automatically by voice-activity detection: about 700 ms of silence, with a hard cap of 20 s. Saying "cancel" or pressing Esc aborts.
- **F29** Romanian and English are both understood, with the language auto-detected per utterance. Replies are spoken in the language of the request.
- **F30** **Fast path:** a deterministic intent grammar handles common commands locally without an AI turn. Examples:
  - "add *X* to today", "remind me at *T* to *X*";
  - "what's next", "what time is it";
  - "start breathing", "I'm done for today", "snooze that", "confirm" / "cancel".
  Everything else goes to the selected agent (F16) with `source=voice`, and the prompt asks for a short, speakable answer.
- **F31** Replies are spoken by local TTS, streamed sentence by sentence, and also appear in the chat. Pressing PTT while Sirius is speaking stops it (barge-in); from M9, so does the wake word.
- **F32** Proposals (F19) can be confirmed by voice ("yes" / "confirm" within 15 s) **except deletes**, which always need a tap in the UI.
- **F33** **Privacy:**
  - audio is processed in memory on the machine and never stored or uploaded by default; only the final transcript reaches the agent;
  - the mic is closed unless a push-to-talk session is running in v1; a visible mic indicator shows whenever it is open;
  - PTT works in quiet mode; from M9, quiet mode disables the wake word by default (configurable);
  - one setting turns all voice off and stops the service.

### 3.x Added 2026-11-03, at the owner's request

- **F34** Goals has a one-line add field, like Today's, for adding a goal by hand.
- **F35** **The list ("To remember"):** things to remember or buy, with no day or time. Adding is one line; ticking an item clears it, and undo brings it back. It does not dim in quiet mode and the 04:00 rollover leaves it alone. Agents add to it with `add_to_list`, and the voice grammar sends "add X to my list" and "pune X pe listă" there instead of to Today.
- **F36** **Attachments:** the chat takes up to three PDF, Markdown or text files per message, 20 MB each. The core reads them (`pdftotext` for PDFs) and keeps the text in memory for an hour, never in the database. The text reaches the agent inside the message, marked as material and not instructions, capped at 150,000 characters with a note when cut. A PDF without a text layer is refused with a reason. Long documents turn into roadmaps with `add_roadmap`.
- **F37** **Schedule:** fixed commitments, weekly on chosen days within an optional term, or once on a date, with times and a place. Kept apart from tasks, shown today and for the week, with a desktop reminder 10 minutes before. Agents add and change it; deleting needs a proposal. The phone gets it as an iCalendar feed for ICSx⁵, which puts it in Android's calendar and widgets with alarms that work offline (ADR 0012).
- **F38** **Phone layout and phone voice:** on a phone the dashboard is one section at a time (Today, Sirius, Plan, List) above a bottom bar with the mic in the middle, opening on Today; the mic opens Sirius. A section that changed while you were elsewhere shows a dot, and a reply that changed something links to it. The desktop keeps its columns. The phone records, the laptop transcribes and acts with the phone's own login, and the phone says the answer with Android's voice, in English or Romanian.
- **F39** **Phone notifications by browser push:** reminders, schedule alerts and agent alerts reach the phone as normal Android notifications, with no extra app. Today offers "Turn on" once. The laptop encrypts each one for the phone (RFC 8291) and signs it with its own key (VAPID, RFC 8292), so the push service in between sees neither the text nor who it is for. A tap opens the tab it is about. Forgetting phones forgets their subscriptions. They need the laptop awake, like the rest; schedule alarms through ICSx⁵ do not.
- **F40** **Themes and voice animation, chosen by asking Sirius:** seven themes (Paper, Midnight Blue, Night Owl, Graphite, Sage, Ember, Orb) and three animations (Sirius, the layered Orbit wolf animated with GSAP, the default since 2026-11-05 in place of the dot-matrix sphere; a ring; a dot) through one agent tool, `set_appearance`, kept as settings so the phone follows. It sits at the top of the chat and, for a whole spoken exchange (listening, thinking, speaking), a large one fades up over the chat without moving it. It runs frames only while listening, thinking or speaking. Replies type out from the thinking dots to the last letter as one bubble, which never blinks when the stored copy replaces it. The phone has no header buttons, and Send turns into Stop while a reply is coming. The phone's splash and first paint use the current theme. Logo studies: `docs/design/sirius-logo/`. References: `docs/design/references/`.
- Removed as filler: the panel slogans, "Small things, if there's room", the chat's suggestion chips, and the "Something small:" prefix in the header's suggestions.

## 4. Non-functional requirements

### 4.1 Performance

These are targets to measure on the Lenovo LOQ, Ubuntu. Add a `bench/` script that reports them.

| Metric | Target |
|---|---|
| Launch to first meaningful paint (core already running) | < 400 ms |
| Task toggle or quick add to visual feedback | < 50 ms (optimistic) |
| Core API p95 for local CRUD | < 10 ms |
| Idle CPU, window visible, leaves on | < 1 % |
| Idle CPU, window hidden or minimized | ≈ 0 (animations paused) |
| Memory: desktop app process tree | < 200 MB |
| Memory: core service | < 80 MB |
| Initial JS bundle | < 250 KB gzipped |
| Voice: PTT → earcon | < 300 ms |
| Voice: end of speech → transcript | < 800 ms on GPU, < 2 s on CPU |
| Voice: fast-path command → spoken acknowledgement | < 1.5 s end to end |
| Voice service idle (mic closed) | < 1 % of one core, < 150 MB RAM |

Rules:
- Animate **only `transform` and `opacity`**. Never animate `top`, `left`, `height`, `box-shadow` or `filter`.
- Pause all CSS animations when `document.visibilityState === 'hidden'`.
- Keep `will-change` limited to the falling leaves and the avatar.
- No heavy dependencies: no UI kits, no Moment, no Lodash. Bundle fonts locally; no runtime network fetches for assets.
- Use React Query with SSE invalidation. No polling.

### 4.2 Other
- **Offline:** everything except Sirius chat works with no network.
- **Privacy:** data stays in local SQLite. Only the chat prompt and tool results go to the AI provider, via the CLI.
- **Accessibility:**
  - real `<button>`, `<input>` and `<label>` elements;
  - touch targets ≥ 44 px;
  - text contrast ≥ 4.5:1;
  - `prefers-reduced-motion` disables leaves, typewriter, avatar motion and the vine;
  - full keyboard navigation.
- **Reliability:** the core survives window crashes. The DB has migrations and daily backups (section 10). No data loss on power cut (SQLite WAL with `synchronous=NORMAL`).

## 5. Architecture decisions (binding)

```
┌────────────────────────────┐        ┌──────────────────────────────────────┐
│ Sirius Desktop (Tauri 2)   │  HTTP  │ Sirius Core  (systemd --user service)│
│  React UI  ───────────────────────► │  Hono REST /v1  +  SSE /v1/events    │
│  autostart, tray, window   │ ◄──SSE │  Domain ops (single source of truth) │
└────────────────────────────┘        │  SQLite (WAL) — the ONLY writer      │
                                      │  Scheduler (reminders, rollover)     │
┌────────────────────────────┐  HTTP  │  Notifier (libnotify → later push)   │
│ sirius-mcp (stdio)         │ ─────► │  Agent runner ──spawns──► claude -p  │
│  used by Claude Code/Codex │        │                         └► codex exec│
└────────────────────────────┘        └──────────────────────────────────────┘
        ▲  hooks / notify  ──────────── POST /v1/agent-events ───────┘

┌──────────────────────────────────────────┐  HTTP + SSE  ┌──────────────┐
│ sirius-voice (Python, systemd --user)    │ ───────────► │ Sirius Core  │
│ mic → openWakeWord → Silero VAD →        │  utterance   │ intent router│
│ faster-whisper (STT) … Piper (TTS) → spk │ ◄─────────── │ fast path |  │
└──────────────────────────────────────────┘  reply text  │ agent turn   │
                                                          └──────────────┘
```

**ADR-1: Desktop shell is Tauri 2 + React + Vite + TypeScript.**
- *Why:* it's a real installable app with its own window, dock entry, autostart, tray and native notifications. It ships as .deb/AppImage, uses roughly a fifth of Electron's footprint, and React is the UI the user wants. Tauri 2 also targets Android/iOS, which keeps a mobile path open.
- *Rejected:*
  - **Electron**: Chromium gives faster, more consistent rendering, but costs 150–300 MB of RAM and a large install. That's the fallback if WebKitGTK performance fails the budgets.
  - **Chromium `--app` window**: the cheapest option, but no tray, notifications or autostart control.
  - **Native GTK/Qt**: no React.
- *Known risk:* Tauri on Linux uses **WebKitGTK**. It is slower than Chromium for heavy CSS animation, and some NVIDIA setups render a blank window unless `WEBKIT_DISABLE_DMABUF_RENDERER=1` is set **[verify on the LOQ]**. M2 must measure the section 4.1 budgets on the target machine and record the result in an ADR.
- *Note:* nearly every "native" Linux desktop app today (WhatsApp clients, Slack, Discord, VS Code) is a web UI in a native shell. What matters is local-first data, instant launch and OS integration, all of which this design has.

**ADR-2: Core is a TypeScript service on Bun (Hono + Drizzle ORM + SQLite), run as a systemd user service.**
- *Why:*
  - One process owns all domain logic and is the **only DB writer**, so the UI, MCP server, hooks and the future phone client all go through one validated API.
  - Running as a service means reminders, notifications and MCP tools work even when the window is closed.
  - The same code becomes the cloud deployment unchanged (ADR-8).
  - TypeScript end to end lets the UI, core and MCP share Zod schemas and types.
- *Why Bun:* fast startup, built-in SQLite, and `bun build --compile` produces a single binary. Hono and Drizzle also run on **Node 24 LTS**, so the runtime can be swapped if Bun ever becomes a liability. Avoid Bun-only APIs outside `packages/core/src/runtime/`.
- *Rejected:*
  - **Rust core inside Tauri:** logic would be duplicated for MCP and cloud, and the user's main languages are C++, Python and TypeScript.
  - **Tauri sidecar lifecycle:** the core would only run while the window is open.

**ADR-3: Storage is SQLite in WAL mode, with sync-ready schema conventions.**
- Every row gets:
  - a **UUIDv7** id;
  - `created_at` and `updated_at` (ms epoch UTC);
  - `deleted_at` (soft delete);
  - `rev` (an integer incremented on each write).
- Every mutation also writes a `change_log` row (entity, id, op, actor, payload, at).
- This costs little now and makes undo (F20), auditing of agent actions, backups and a future multi-device sync or migration tractable.
- Migrations use Drizzle Kit, run on core start.
- SQLite is also the cloud store: single user, single writer. Postgres is unnecessary.

**ADR-4: Live updates use Server-Sent Events.**
- `GET /v1/events` streams `{entity, id, op, rev}`. The UI invalidates React Query caches.
- SSE is simpler than WebSockets, works through Cloudflare Tunnel, and is one-directional, which is all that's needed.

**ADR-5: The assistant runs the official CLIs as subprocesses, on the user's subscriptions.**
- Claude runs as `claude -p`. Headless Claude Code on a Pro/Max subscription is a documented, allowed use and draws on the subscription's Agent SDK credit **[verify current terms and credit size]**.
- Codex runs as `codex exec` on the user's **ChatGPT** plan. Codex is *not* covered by the Claude subscription.
- **Never extract or reuse OAuth tokens** to call model APIs directly. That violates Anthropic's terms. Always spawn the official binary.
- Each agent sits behind an `AgentAdapter` interface (section 8), so adding an API-key adapter later is one file.
- *Trade-off accepted:* CLI cold start adds latency (likely 1–4 s per turn, **measure in M4**). Quick add (F6) and the "What should I do now?" rules (F3) avoid AI entirely, so common actions stay instant.

**ADR-6: Actions go through MCP; `sirius-mcp` is a thin stdio adapter over the core API.**
- One tool surface serves Sirius chat **and** any interactive Claude Code or Codex session (e.g. "add a probability roadmap" from a coding terminal).
- stdio is supported by both CLIs; Codex supports stdio MCP servers **[verify HTTP support]**.
- The adapter holds no logic. It validates input with the shared Zod schemas and calls `/v1`.

**ADR-7: Safety lives in the core, not the prompt.**
- `codex exec` runs without approval prompts, and headless `claude -p` cannot show permission prompts.
- So the proposal and confirm rule (F19) is enforced by the core's op classification, and the agents run with **no built-in tools** (no file, shell or web access). They get only the `sirius` MCP server, from an empty working directory.

**ADR-8: Cloud readiness means the same core image deploys to the homelab.**
- `infra/Dockerfile` builds the core binary.
- `infra/compose.yaml` runs it with a volume for `/data`, **Litestream** replicating SQLite to object storage or a local backup target, and a **Cloudflare Tunnel** with **Cloudflare Access** in front (the user already runs Cloudflare Tunnels on the homelab).
- Auth: local mode uses a bearer token; remote mode trusts Cloudflare Access JWT headers plus the same token for non-browser clients.
- Config is entirely via env vars (`SIRIUS_DATA_DIR`, `SIRIUS_PORT`, `SIRIUS_TOKEN_FILE`, `SIRIUS_MODE=local|remote`, …).

**ADR-9: Mobile comes later, as a PWA first.**
- The React UI is built responsive from day one: panels stack below 900 px, as in the mockup.
- Phase M8 serves the same UI as a PWA from the homelab core, behind Cloudflare Access. Phone notifications go through **ntfy** (self-hosted) or Web Push, behind the `Notifier` interface.
- A Tauri 2 mobile build is optional later, if the PWA isn't enough.
- *Caveat:* when the core moves to the homelab, the agent runner moves with it, so `claude` and `codex` must be installed and logged in there. That is still single-user, personal use **[verify terms]**.

**ADR-10: Voice is a separate local service, `sirius-voice` (Python 3.12, managed with uv, run as a systemd user service). Everything runs on-device.**
- *Pipeline:*
  1. Capture: PipeWire via PortAudio (`sounddevice`), 16 kHz mono.
  2. **openWakeWord** *(M9, not v1)*: a custom "hey Sirius" model trained on synthetic speech (**[verify]** training workflow); a bundled pre-trained word serves as a placeholder until then. In v1, PTT opens the mic instead.
  3. **Silero VAD** for endpointing.
  4. **faster-whisper** (CTranslate2) for speech-to-text. Model `small` by default, `medium` optional. Uses CUDA on the LOQ's NVIDIA GPU when available, with a CPU int8 fallback. Multilingual, so Romanian and English both work.
  5. Post the utterance to the core, which routes it either to the **fast-path intent grammar** or to an **agent turn**.
  6. Reply text streams back over SSE and is spoken by **Piper** TTS (local; English and Romanian voices, e.g. `ro_RO` **[verify voice quality]**), sentence by sentence.
- *Why a separate service and not part of the core or the webview:*
  - the audio and ML stack is native to Python;
  - a crash or GPU problem in voice can't take down the core or the UI;
  - it can be disabled or uninstalled independently;
  - PTT, and later wake-word listening, must work when the window is closed.
- *Why fully local:* privacy (an always-on mic must not stream anywhere), latency, and cost. It also respects the "everything under the subscription" constraint: no cloud speech API bills.
- *Why the fast path:* agent turns through a CLI cost seconds. The commands you'd say most often ("add X", "done for today") should respond as fast as a light switch. The grammar lives in the core (TypeScript), shares the ops from section 7, and has its own unit tests.
- *Interfaces:* `WakeWord`, `Vad`, `Stt` and `Tts` are small Python protocols, so any engine can be swapped by configuration:
  - **Porcupine** if openWakeWord's false-accept rate is too high (needs an access key);
  - **whisper.cpp** if CUDA is a hassle on CPU-only machines;
  - another TTS if Piper's Romanian voice is weak.
- *Rejected:*
  - the browser Web Speech API: unavailable in WebKitGTK and cloud-backed in Chrome;
  - cloud STT/TTS: privacy, recurring cost, and not covered by the subscriptions;
  - the Claude apps' voice mode: not scriptable.
- *Phone (M8):* the PWA records with `MediaRecorder` and uploads audio to the homelab core. That core forwards it to a `sirius-voice` instance there, using the same STT path. There is no wake word on the phone; it's push-to-talk only.

## 6. Data model (v1)

All tables also have the common columns from ADR-3: `id uuidv7 pk`, `created_at`, `updated_at`, `deleted_at`, `rev`.

```
tasks           title, tier('priority'|'small'), scheduled_for(date), status('open'|'done'|'dropped'),
                position, completed_at, source('user'|'sirius'|'mcp'|'roadmap'), roadmap_step_id?
goals           title, horizon_text?, target_date?, status('active'|'paused'|'done'), position
milestones      goal_id, title, position, done_at?
roadmaps        title, subtitle?, status('active'|'later'|'done'), position
roadmap_steps   roadmap_id, title, est_minutes?, position, status('todo'|'done'), done_at?
reminders       kind('prayer'|'wellbeing'|'custom'), label, time_local('HH:MM'), weekdays(bitmask),
                enabled, snoozed_until?
day_state       date pk, quiet_mode, quiet_since?
proposals       actor('claude'|'codex'), summary, ops(json), status('pending'|'applied'|'rejected'|'expired'),
                decided_at?, expires_at
agent_events    source('claude'|'codex'), kind('needs_input'|'turn_complete'|'error'), project?, message?,
                acknowledged_at?
conversations   agent('claude'|'codex'), model, cli_session_id?, title?
messages        conversation_id, role('user'|'assistant'|'tool'), text, meta(json)
voice_turns     conversation_id?, lang, transcript, route('fast_path'|'agent'), intent?, latency_ms(json)   -- no audio
settings        key pk, value(json)   -- incl. voice.enabled, voice.wake_word_in_quiet, voice.stt_model, voice.tts_voice_{en,ro}
change_log      entity, entity_id, op('create'|'update'|'delete'), actor, payload(json), at
```

## 7. Domain operations (shared by REST and MCP)

Define each operation once in `packages/core/src/ops/` with a Zod input schema and a **class** of `additive` or `bulk_or_destructive`. REST routes and MCP tools are generated from or registered against the same definitions.

| MCP tool / op | Class | Notes |
|---|---|---|
| `get_today` | read | tasks, quiet mode, next reminder |
| `list_goals`, `list_learning`, `list_reminders` | read | |
| `add_task(title, tier?, date?)` | additive | default tier `small`, date today |
| `complete_task(id)`, `reopen_task(id)` | additive | single item |
| `reschedule_task(id, date)` | additive | single item |
| `add_goal(title, horizon_text?, target_date?, milestones?[])` | additive | |
| `add_milestone(goal_id, title)`, `complete_milestone(id)` | additive | |
| `add_roadmap(title, subtitle?, steps?[])` | additive | |
| `add_roadmap_step(roadmap_id, title, est_minutes?)` | additive | |
| `set_reminder(label, kind, time_local, weekdays)` | additive | |
| `snooze_reminder(id, until)` | additive | |
| `set_quiet_mode(on)` | additive | |
| `propose_changes(summary, ops[])` | proposal | the **only** route for bulk moves, edits of several items, and any delete |

REST surface: `/v1/tasks`, `/v1/goals`, …, `/v1/proposals/:id/confirm|reject`, `/v1/undo/:change_id`, `/v1/agent-events`, `/v1/chat` (start or continue a turn; streams via SSE), `/v1/voice/utterance` (transcript in; returns `{route, turn_id}`, with the reply streamed over SSE), `/v1/voice/state` (listening, speaking or idle, which drives the avatar), `/v1/events`. Generate an OpenAPI document from the Zod schemas (`@hono/zod-openapi`) and a typed client for the UI.

## 8. Agent adapters

```ts
interface AgentAdapter {
  id: 'claude' | 'codex';
  available(): Promise<{ ok: boolean; reason?: string }>; // binary present, logged in
  run(turn: { prompt: string; model: string; sessionId?: string; signal: AbortSignal }):
    AsyncIterable<{ type: 'text'; delta: string }
                | { type: 'tool'; name: string }
                | { type: 'done'; sessionId?: string }
                | { type: 'error'; message: string }>;
}
```

Common to both:
- Working directory is an empty `~/.local/share/sirius/agent-cwd/`.
- The system prompt comes from `packages/core/prompts/sirius.md`: direct, brief, uses tools, never asks to change files, prefers `propose_changes` for anything bulk.
- Timeout 60 s; cancellable from the UI.
- Spawn with `execFile`-style argv, never a shell string.

**Claude** **[verify all flags with `claude --help`]**:
```
claude -p "<prompt>" --model <haiku-5.5 id> --output-format stream-json
       --mcp-config <sirius-mcp.json> --strict-mcp-config
       --allowedTools "mcp__sirius__*"   # plus disable built-in tools (e.g. --tools "" or --disallowedTools ...)
       [--resume <session_id>]
```

**Codex** **[verify all flags with `codex exec --help`]**:
```
codex exec --json -m <model> --sandbox read-only "<prompt>"     [resume: codex exec resume <id>]
# sirius MCP registered in a dedicated CODEX_HOME so it does not touch the user's main config:
# [mcp_servers.sirius]  command = "sirius-mcp"
```

## 9. Agent-attention integration

- Ship a tiny CLI, `sirius notify --source claude|codex --kind <k> [--project <p>] [--message <m>]`. It POSTs to the core and exits 0 even if the core is down. Hooks must never block an agent.
- **Claude Code** (`~/.claude/settings.json`):
  - a `Notification` hook with matcher `permission_prompt|idle_prompt` → `kind=needs_input`;
  - a `Stop` hook → `kind=turn_complete`, off by default because it is too chatty.
  - Hook input arrives as JSON on stdin (`hook_event_name`, `cwd`, `message`). Derive `project` from `cwd`.
- **Codex** (`~/.codex/config.toml`): `notify = ["sirius", "notify", "--source", "codex", "--from-codex-json"]`. Codex passes a JSON argument, and `agent-turn-complete` is the documented type **[verify for newer event types]**.
- `sirius setup-hooks` prints, or with `--apply` merges, these configs, and backs up the originals first.

## 10. Repository layout and tooling

```
sirius/
  apps/desktop/          Tauri 2 (src-tauri/) + React UI (src/)
  packages/ui/           React components, tokens.css, SiriusAvatar, motion CSS
  packages/contracts/    Zod schemas, op definitions, generated API client & types
  packages/core/         Hono server, ops, Drizzle schema & migrations, scheduler, notifier, agent adapters
  packages/mcp/          stdio MCP server (@modelcontextprotocol/sdk) → calls core
  packages/cli/          `sirius` CLI: notify, setup-hooks, backup, doctor, voice ptt
  services/voice/        Python 3.12 (uv): wake word, VAD, STT, TTS; pytest; systemd unit
  infra/                 Dockerfile, compose.yaml, litestream.yml, systemd/sirius-core.service
  docs/                  REQUIREMENTS.md, adr/, verified.md, design/
  bench/                 startup/latency/memory measurements
```

- Tooling: Bun workspaces; TypeScript `strict`; Biome for lint and format; Vitest for unit and integration tests; Playwright for UI against the Vite build.
- CI: GitHub Actions with Bun, Cargo and Playwright caches. The Tauri `.deb` and AppImage build in CI on tags.
- Desktop plugins: `tauri-plugin-autostart` (XDG autostart), `tauri-plugin-single-instance`, tray icon, `tauri-plugin-notification` (only for in-window use; the core owns OS notifications).
- Install script: builds and installs the core binary to `~/.local/bin`, enables `systemctl --user enable --now sirius-core`, installs the .deb, and registers MCP in Claude Code (`claude mcp add` **[verify]**) and Codex.
- Backups: a daily `VACUUM INTO` snapshot in `~/.local/share/sirius/backups/`, keeping 14 days. Litestream in remote mode.

## 11. Design system (from the mockup)

| Token | Value |
|---|---|
| `--bg` | `#EBE3D1` (beige ground) |
| `--panel` | `#F4EEE1`, border `rgba(26,24,20,.13)`, radius 20px |
| `--ink` | `#1A1814` (text, primary buttons) |
| `--ink-2` / `--muted` | `#3A362E` / `#5F5849` |
| `--accent` | `#5F6B3A` (olive: vine, breathing, success) |
| `--bubble-sirius` / `--input` | `#EAE1CE` / `#FBF8F0` |
| Leaf palette | `#8C9159 #B49560 #A8714A #7D8560` at 60 % opacity |
| Sirius palette | greys `#8A847D #78726B #5A554F`, mask `#F2EBDE`, eyes `#8CC6DB`, star `#C9A85C` |
| Type | **Newsreader** (OFL, self-hosted woff2), variable opsz/wght. H1 46/400, panel titles 26/500, body 18–21, labels 12px uppercase `.14em`. Clock 44/300 with tabular numerals, inline before the date |
| Controls | pill buttons, 1.5px ink border, min-height 44–46px |
| Motion | panel rise 1s, stagger 0.25s; caret blink 1.1s; vine 2.6s; breathing 8s; avatar idle 5.5s bob, 6.5s blink, ear twitches 9/13s, glance 15s, star twinkle 11s; leaves 27–42s fall, 6–9s sway |

The mockup uses Newsreader as a stand-in for Claude's typeface, which is proprietary and not licensable. Keep Newsreader, or swap in Source Serif 4.

## 12. Milestones and acceptance criteria

| # | Deliverable | Done when |
|---|---|---|
| **M0** | Repo skeleton, CI, tokens, the full dashboard ported to React with fixture data (no backend) | Pixel-close to the mockup at 1440 and 390 px; all mockup interactions work on fixtures; Lighthouse a11y ≥ 95; reduced-motion verified |
| **M1** | Core service: schema, migrations, ops, REST, SSE, scheduler (rollover, reminders), notifier; UI wired with optimistic updates | Unit tests per op incl. classification; UI updates live from a `curl` POST; works offline; p95 < 10 ms |
| **M2** | Tauri shell: autostart, tray, single instance; core as systemd user service; .deb and AppImage | Fresh login on the LOQ opens the dashboard; budgets in section 4.1 measured and recorded (ADR for WebKitGTK result) |
| **M3** | `sirius-mcp`; proposals, confirm and undo; registered in Claude Code and Codex | From an interactive `claude` session: "add a goal…" appears live; a bulk move creates a pending proposal and nothing changes until Confirm |
| **M4** | Sirius chat: adapters, streaming, sessions, agent switch, error states, avatar states | Both agents complete add, move (proposal) and roadmap flows; built-in tools provably disabled (test: ask it to read a file, which must fail); latency measured |
| **M5** | Agent attention: `sirius notify`, hook setup, toasts and native notifications, quiet-mode queueing | A Claude permission prompt in another terminal produces one toast and one notification within 2 s; suppressed in quiet mode and shown on "Welcome back" |
| **M6** | Voice: `sirius-voice` service with push-to-talk; fast-path grammar; Piper replies; barge-in; avatar listening and speaking states | PTT "add buy rice to today" lands in Today and is acknowledged aloud within the section 4.1 budgets; works in Romanian and English; no audio files on disk |
| **M7** | *Built, not deployed: acceptance needs a homelab.* Remote mode: Docker, compose, Litestream, Cloudflare Tunnel + Access; desktop can point at a remote core | Core runs on the homelab; desktop works against it; restore-from-backup drill documented and done once |
| **M8** | *Built, not deployed: acceptance needs a homelab and a phone.* Phone: PWA from the remote core, responsive layout, ntfy/Web Push notifier, push-to-talk voice | Add to home screen on the phone; Today, Goals and Learning usable; agent-attention push arrives; voice PTT works over the tunnel |
| **M9** | Special additions: extras that make Sirius nicer but are not needed for v1. They run on the laptop and need no homelab, so this does not wait for M7 or M8. First item: the openWakeWord "Hey Sirius" wake word (F26). More are added here as they come up | Wake word: false-accepts fewer than once per hour across a normal 2-hour work session (measured). Each new item states its own acceptance when it is added |

## 13. Open questions and things to verify

1. Exact model IDs: Claude Haiku 5.5 for the CLI `--model` flag, and the Codex model the user calls "6.1 Sol Light".
2. Current `claude -p` flags: disabling built-in tools, `--strict-mcp-config`, `--resume`, stream-json event shapes.
3. Current `codex exec` flags: `--json` event shapes, model selection, sandbox, resume, MCP config, and newer `notify` event types.
4. Size and behavior of the Pro subscription's Agent SDK credit for `claude -p`, and what happens when it runs out.
5. WebKitGTK rendering performance and the DMA-BUF/NVIDIA issue on the LOQ (decides Tauri vs the Electron fallback).
6. Whether "Sirius" should also run a daily morning summary (off by default; it would cost one agent turn per day).
7. Voice:
   - the openWakeWord custom-model training workflow and its false-accept rate for "hey Sirius";
   - the CUDA and cuDNN versions faster-whisper needs on the LOQ's driver;
   - the quality of Piper's Romanian voice;
   - PipeWire mic access from a systemd user service.
