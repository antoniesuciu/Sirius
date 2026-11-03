# ADR 0010: the phone uses the laptop's core, and keeps a copy for when it is away

Status: accepted, 2026-11-03. Decided by the owner: the laptop is the server, Claude and Codex
stay on it, and the phone should show everything even while the laptop is offline.

Decision:

- **Reach.** The phone reaches the laptop over Tailscale. `tailscale serve` gives HTTPS, which
  Chrome needs before a web app may use the microphone, and forwards to `127.0.0.1:7337`. The core
  never listens beyond the laptop.
- **Pairing.** `sirius pair` shows a six-digit code, good once for five minutes, with five guesses.
  The phone trades it for its own token, stored on the laptop only as a hash. Only the laptop's
  own token can start a pairing or sign phones out, with `sirius forget-phones`.
- **Offline copy.** The phone keeps the React Query cache in localStorage for 30 days, and its
  service worker keeps the app's files from the first visit. Away from the laptop it shows that
  copy with the time it was last in reach.
- **Changes while away.** Every change is a plain queued op with a key. It waits on the phone,
  survives closing the app, and is sent when the laptop is back. The core answers a key it has
  seen with its first answer, for 30 days, so a resend never applies twice. The laptop is the
  authority, and a change it refuses is reported on the phone. Proposals, undo, the agent switch
  and a new conversation never queue, because they depend on the core's state at that moment.
- **Updates.** Each install copies the built app next to the core, and the service worker fetches
  network first, so the phone gets a new version the next time it opens Sirius in reach.

Not offline: chat and voice, which run on the laptop. Reminders cannot reach the phone while the
laptop is off, because an Android web app cannot reliably schedule its own notifications.

Rejected: a container with `claude` and `codex` in it, which would need the subscriptions' logins
copied into it; and a server core that calls the laptop for agent turns, which only pays off once
an always-on server exists.
