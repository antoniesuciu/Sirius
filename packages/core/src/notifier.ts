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
}

export class LibnotifyNotifier implements Notifier {
  notify({ title, body }: Notification): void {
    execFile('notify-send', ['--app-name=Sirius', '--urgency=low', '--', title, body], (error) => {
      // A desktop with no notification daemon must never take the core down.
      if (error) console.warn('notify-send failed:', error.message);
    });
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
}

export const NOTIFY_WINDOW_MS = 2 * 60 * 1000;

/** At most one notification per key per window. Later ones in the window are dropped. */
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
}
