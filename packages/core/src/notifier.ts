/** Desktop notifications (F24, F25), behind a seam so the phone can add ntfy later (ADR-9). */
import { execFile } from 'node:child_process';

export interface Notification {
  /** Identifies where this came from. Rate limits apply per key. */
  key: string;
  title: string;
  body: string;
}

export interface Notifier {
  notify(notification: Notification): void;
  /** What `key` announced is no longer true, such as an answered prompt: take it down. */
  withdraw?(key: string): void;
}

/** Normal, because GNOME puts a low urgency notification in the tray with no banner at all. */
export function notifySendArgs(title: string, body: string): string[] {
  return ['--app-name=Sirius', '--urgency=normal', '--', title, body];
}

type Run = (
  file: string,
  args: string[],
  done: (error: Error | null, stdout: string) => void,
) => void;
const run: Run = (file, args, done) =>
  execFile(file, args, (error, stdout) => done(error, String(stdout)));

/**
 * One desktop notification per key, kept current: a newer alert replaces the shown one in
 * place, and an answered one is closed, so nothing stale stays in GNOME's list (2026-11-06).
 */
export class LibnotifyNotifier implements Notifier {
  private readonly ids = new Map<string, number>();

  constructor(private readonly exec: Run = run) {}

  notify({ key, title, body }: Notification): void {
    const shown = this.ids.get(key);
    const args = [
      '--print-id',
      ...(shown ? [`--replace-id=${shown}`] : []),
      ...notifySendArgs(title, body),
    ];
    this.exec('notify-send', args, (error, stdout) => {
      // A desktop with no notification daemon must never take the core down.
      if (error) return console.warn('notify-send failed:', error.message);
      const id = Number.parseInt(stdout.trim(), 10);
      if (id > 0) this.ids.set(key, id);
    });
  }

  withdraw(key: string): void {
    const id = this.ids.get(key);
    if (!id) return;
    this.ids.delete(key);
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
        String(id),
      ],
      (error) => {
        if (error) console.warn('closing a notification failed:', error.message);
      },
    );
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
