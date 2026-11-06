/** Desktop notifications (F24, F25), behind a seam so the phone can add ntfy later (ADR-9). */
import { type ChildProcess, execFile, execFileSync, spawn } from 'node:child_process';

export interface Notification {
  /** Identifies where this came from. Rate limits apply per key. */
  key: string;
  title: string;
  body: string;
  /** Desktop app id of the terminal the agent runs in: clicking the alert focuses it. */
  app?: string;
  /** The agent's folder, as window titles show it: a click raises that window of `app`. */
  folder?: string;
  /** News rather than a waiting state: take it down by itself after this long. */
  expireMs?: number;
}

export interface Notifier {
  notify(notification: Notification): void;
  /** What `key` announced is no longer true, such as an answered prompt: take it down. */
  withdraw?(key: string): void;
}

/**
 * Normal, because GNOME puts a low urgency notification in the tray with no banner at all.
 * `desktop-entry` makes GNOME treat the alert as the terminal's, so a click focuses it.
 */
export function notifySendArgs(title: string, body: string, app?: string): string[] {
  return [
    '--app-name=Sirius',
    '--urgency=normal',
    ...(app ? [`--hint=string:desktop-entry:${app}`] : []),
    '--',
    title,
    body,
  ];
}

type Run = (file: string, args: string[], done: (error: Error | null) => void) => void;
const run: Run = (file, args, done) => execFile(file, args, (error) => done(error));

export type Start = (args: string[]) => ChildProcess;
// stdbuf execs notify-send (same pid): into a pipe it would hold the id back until it exits.
const start: Start = (args) =>
  spawn('stdbuf', ['-oL', 'notify-send', ...args], { stdio: ['ignore', 'pipe', 'ignore'] });

/** The sirius-focus GNOME Shell extension (ADR 0015): only the shell may raise a window. */
export interface WindowFocus {
  available(): boolean;
  /** Raise `app`'s most recent window whose title names `folder` ('' = any of its windows). */
  activate(app: string, folder: string): Promise<boolean>;
}

const FOCUS = ['--session', '--dest', 'org.gnome.Shell', '--object-path', '/org/sirius/Focus'];

/**
 * Through gdbus, like the close call. Once the extension answers it is taken as there for the
 * life of the core; until then each alert asks again, so a login that loads it is picked up.
 */
export function gdbusFocus(): WindowFocus {
  let there = false;
  return {
    available() {
      if (there) return there;
      try {
        // Rare (one alert per agent per window, F25) and short, so a blocking probe is fine.
        // A path with nothing on it still introspects cleanly, so look for the interface.
        there = execFileSync('gdbus', ['introspect', ...FOCUS], {
          encoding: 'utf8',
          timeout: 500,
        }).includes('org.sirius.Focus');
      } catch {}
      return there;
    },
    activate: (app, folder) =>
      new Promise((resolve) =>
        execFile(
          'gdbus',
          ['call', ...FOCUS, '--method', 'org.sirius.Focus.Activate', app, folder],
          { timeout: 2000 },
          (error, out) => resolve(!error && out.includes('true')),
        ),
      ),
  };
}

interface Shown {
  child: ChildProcess;
  id?: number;
  timer?: ReturnType<typeof setTimeout>;
}

/**
 * One desktop notification per key, taken down once answered (2026-11-06).
 *
 * GNOME 46 ties a notification whose app it recognises (Sirius.desktop, or the terminal's
 * desktop-entry) to the sender's D-Bus connection and destroys it when the sender leaves,
 * which a plain notify-send does at once: the id is dead before it can be replaced or closed,
 * and the banner is orphaned. So each alert's notify-send stays alive (--wait) until it is
 * answered; killing it, then closing its id, takes the alert down.
 * shortcut: GNOME keeps one source per app, watching its first sender, so answering one agent
 * also clears another agent's alert from the same terminal app; fine for one agent at a time.
 */
export class LibnotifyNotifier implements Notifier {
  private readonly shown = new Map<string, Shown>();

  constructor(
    private readonly startNotify: Start = start,
    private readonly exec: Run = run,
    private readonly focus: WindowFocus = gdbusFocus(),
  ) {}

  notify({ key, title, body, app, folder, expireMs }: Notification): void {
    this.withdraw(key);
    // A default action makes GNOME hand the click to us instead of activating the app itself,
    // so it is only added when the extension can do better (ADR 0015).
    const raise = app && folder && this.focus.available() ? { app, folder } : undefined;
    const entry: Shown = {
      child: this.startNotify([
        '--wait',
        '--print-id',
        ...(raise ? ['--action=default=Open'] : []),
        ...notifySendArgs(title, body, app),
      ]),
    };
    this.shown.set(key, entry);
    const forget = () => {
      clearTimeout(entry.timer);
      if (this.shown.get(key) === entry) this.shown.delete(key);
    };
    // A desktop with no notification daemon must never take the core down.
    entry.child.on('error', (error) => {
      console.warn('notify-send failed:', error.message);
      forget();
    });
    // Its id first, then the name of a clicked action.
    entry.child.stdout?.on('data', (chunk) => {
      for (const line of String(chunk).split('\n')) {
        const id = Number.parseInt(line, 10);
        if (!entry.id && id > 0) entry.id = id;
        else if (line === 'default' && raise) {
          void this.focus
            .activate(raise.app, raise.folder)
            .then((found) => found || this.focus.activate(raise.app, ''));
        }
      }
    });
    // Clicked or dismissed: GNOME closed it, so there is nothing left to take down.
    entry.child.on('exit', forget);
    if (expireMs)
      entry.timer = setTimeout(() => this.shown.get(key) === entry && this.withdraw(key), expireMs);
  }

  withdraw(key: string): void {
    const entry = this.shown.get(key);
    if (!entry) return;
    this.shown.delete(key);
    clearTimeout(entry.timer);
    // Only once its sender is gone will GNOME's proxy accept a close for the id from us.
    entry.child.once('exit', () => {
      if (!entry.id) return;
      this.exec(
        'gdbus',
        [
          'call',
          '--session',
          '--dest',
          'org.freedesktop.Notifications',
          '--object-path',
          '/org/freedesktop/Notifications',
          '--method',
          'org.freedesktop.Notifications.CloseNotification',
          String(entry.id),
        ],
        // Usually GNOME already destroyed it along with its sender; nothing to report.
        () => {},
      );
    });
    entry.child.kill();
  }
}

/** Phone notifications through a self-hosted ntfy topic (ADR-9). */
export class NtfyNotifier implements Notifier {
  constructor(private readonly topicUrl: string) {}

  notify({ title, body }: Notification): void {
    fetch(this.topicUrl, { method: 'POST', body, headers: { title } }).catch((error) => {
      console.warn('ntfy failed:', error);
    });
  }
}

export class FanOutNotifier implements Notifier {
  constructor(private readonly targets: Notifier[]) {}

  notify(notification: Notification): void {
    for (const target of this.targets) target.notify(notification);
  }

  withdraw(key: string): void {
    for (const target of this.targets) target.withdraw?.(key);
  }
}

export const NOTIFY_WINDOW_MS = 2 * 60 * 1000;

/**
 * At most one notification per key per window (F25); later ones in the window are dropped.
 * A withdrawal ends the window: once a prompt is answered, the next one is news again.
 */
export class RateLimitedNotifier implements Notifier {
  private readonly last = new Map<string, number>();

  constructor(
    private readonly inner: Notifier,
    private readonly clock: () => number,
    private readonly windowMs = NOTIFY_WINDOW_MS,
  ) {}

  notify(notification: Notification): void {
    const now = this.clock();
    const previous = this.last.get(notification.key);
    if (previous !== undefined && now - previous < this.windowMs) return;
    this.last.set(notification.key, now);
    this.inner.notify(notification);
  }

  withdraw(key: string): void {
    this.last.delete(key);
    this.inner.withdraw?.(key);
  }
}
