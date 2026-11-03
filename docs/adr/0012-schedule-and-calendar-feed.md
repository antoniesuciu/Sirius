# ADR 0012: a schedule of fixed commitments, shared with the phone as a calendar feed

Status: accepted, 2026-11-03. Asked for by the owner: a schedule of things that are always there,
which Sirius can add to, kept apart from today's tasks, on the phone with a widget and alerts.

Decision:

- **Separate from tasks.** `schedule_events` holds commitments that repeat weekly on chosen days,
  optionally within a term (`starts_on`, `ends_on`), or happen once on a date. They never roll
  over and are never tasks. `get_today` carries today's events, so an agent sees them with the day.
- **Agents may add and change, not delete.** Adding and editing are additive. A delete is
  `bulk_or_destructive`, so an agent has to propose it.
- **A reminder 10 minutes before**, as a desktop notification, silent in quiet mode.
- **The phone gets a calendar feed, not a widget of our own.** An Android home-screen widget needs
  a native app, which a web app cannot be. The core serves the schedule as iCalendar at
  `/calendar/<secret>.ics`. ICSx⁵, a free and open-source app, subscribes over Tailscale and writes
  the events into Android's own calendar. Any calendar widget then shows them, and their alarms,
  set 10 minutes before, ring with the laptop off.

The feed address carries its own secret, because calendar apps cannot send a bearer token. It is
reachable only inside the tailnet. Anyone holding the address can read the schedule, so
`sirius calendar` says to keep it private.

Not done: a native Android widget, and syncing with Google Calendar. Google subscribes from its own
servers, which cannot reach a tailnet.
