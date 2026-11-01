/**
 * Time-driven work (F8, F13, section 10): rollover, reminders, proposal expiry, backups.
 * It wakes on the minute with a self-rescheduling timeout, and every step in `tick` is
 * idempotent and works from the wall clock, so a late wake after suspend simply catches up.
 */
import { formatDate, localParts, logicalDate, weekdayOf, zonedInstant } from '@sirius/contracts';
import { and, eq, isNull, lt, lte } from 'drizzle-orm';
import type { Backups } from './backups.ts';
import { proposals, reminders, tasks } from './db/schema.ts';
import type { Notifier } from './notifier.ts';
import { makeContext, type OpHooks } from './ops/context.ts';
import { nextTaskPosition } from './ops/tasks.ts';
import type { Attention } from './services/attention.ts';
import type { Store, Tx } from './store.ts';

/** A reminder missed by more than this (a suspended laptop, say) is let go, not fired late. */
const REMINDER_GRACE_MS = 5 * 60 * 1000;

export class Scheduler {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private lastDate: string | null = null;

  constructor(
    private readonly store: Store,
    private readonly timeZone: string,
    private readonly notifier: Notifier,
    private readonly attention: Attention,
    private readonly hooks: OpHooks,
    private readonly backups: Backups | null,
  ) {}

  start(): void {
    const loop = () => {
      this.safeTick();
      this.timer = setTimeout(loop, 60_000 - (Date.now() % 60_000) + 50);
    };
    loop();
  }

  stop(): void {
    clearTimeout(this.timer);
  }

  private safeTick(): void {
    try {
      this.tick();
    } catch (error) {
      // One bad tick must not stop reminders for the rest of the day.
      console.error('Scheduler tick failed', error);
    }
  }

  tick(): void {
    const now = this.store.now();
    const today = logicalDate(now, this.timeZone);
    this.rollover(today);
    this.expireProposals(now);
    this.fireReminders(now);
    if (this.lastDate !== null && this.lastDate !== today) this.releaseQuiet(this.lastDate);
    this.lastDate = today;
    this.backups?.runDaily(today);
  }

  /** F8: open tasks move silently to the new day. Nothing is ever "overdue". */
  private rollover(today: string): void {
    const stale = this.store.db
      .select()
      .from(tasks)
      .where(
        and(eq(tasks.status, 'open'), isNull(tasks.deleted_at), lt(tasks.scheduled_for, today)),
      )
      .orderBy(tasks.scheduled_for, tasks.position)
      .all();
    if (stale.length === 0) return;
    this.store.write('system', (tx) => {
      const ctx = makeContext(tx, this.timeZone, 'system', this.hooks);
      for (const task of stale) {
        tx.update('tasks', task.id, {
          scheduled_for: today,
          position: nextTaskPosition(ctx, today),
        });
      }
    });
  }

  private expireProposals(now: number): void {
    const stale = this.store.db
      .select()
      .from(proposals)
      .where(and(eq(proposals.status, 'pending'), lte(proposals.expires_at, now)))
      .all();
    if (stale.length === 0) return;
    this.store.write('system', (tx) => {
      for (const p of stale) {
        tx.update('proposals', p.id, { status: 'expired', decided_at: tx.now });
      }
    });
  }

  private calendarDate(now: number): string {
    const parts = localParts(now, this.timeZone);
    return formatDate(parts.year, parts.month, parts.day);
  }

  /** The instant a reminder is due today, if it is due today at all. */
  private dueAt(reminder: typeof reminders.$inferSelect, now: number): number | null {
    const date = this.calendarDate(now);
    if (reminder.last_fired_on === date) return null;
    if (!(reminder.weekdays & (1 << weekdayOf(date)))) return null;
    return zonedInstant(date, reminder.time_local, this.timeZone);
  }

  private fireReminders(now: number): void {
    const rows = this.store.db
      .select()
      .from(reminders)
      .where(and(isNull(reminders.deleted_at), eq(reminders.enabled, true)))
      .all();
    for (const reminder of rows) {
      const snoozed = reminder.snoozed_until;
      const snoozeDue = snoozed !== null && snoozed <= now;
      const stillSnoozed = snoozed !== null && snoozed > now;
      const at = stillSnoozed ? null : this.dueAt(reminder, now);
      const regularDue = at !== null && at <= now && now - at < REMINDER_GRACE_MS;
      if (!snoozeDue && !regularDue) continue;
      this.store.write('system', (tx) => {
        tx.update('reminders', reminder.id, {
          snoozed_until: null,
          last_fired_on: this.calendarDate(now),
          ...(reminder.once ? { enabled: false } : {}),
        });
        if (this.isQuiet(tx)) return;
        tx.afterCommit(() =>
          this.notifier.notify({
            key: `reminder:${reminder.id}`,
            title: 'Sirius',
            body: reminder.label,
          }),
        );
      });
    }
  }

  private isQuiet(tx: Tx): boolean {
    return tx.peek('day_state', logicalDate(tx.now, this.timeZone))?.quiet_mode ?? false;
  }

  /** Quiet mode ends by itself at rollover, and queued events surface then too. */
  private releaseQuiet(previousDate: string): void {
    const day = this.store.write('system', (tx) => tx.peek('day_state', previousDate));
    if (day?.quiet_mode && day.quiet_since !== null) this.attention.releaseSince(day.quiet_since);
  }
}
