/** Agent attention (F23–F25): record, coalesce, notify, and queue through quiet mode. */
import {
  type AgentEvent,
  type AgentId,
  describeAgentEvent,
  logicalDate,
  type OpInput,
} from '@sirius/contracts';
import { and, asc, eq, gte, isNull } from 'drizzle-orm';
import type { EventBus } from '../bus.ts';
import { agent_events } from '../db/schema.ts';
import type { Notifier } from '../notifier.ts';
import type { Store, Tx } from '../store.ts';

/** A session that has said nothing for this long has stopped, even without a Stop hook. */
export const ACTIVITY_MS = 15 * 60 * 1000;
/** How long a "finished" alert stays on the desktop (2026-11-06). */
export const NEWS_MS = 5000;

export class Attention {
  /** Sessions in any terminal, by agent and folder: when each last showed it was working. */
  private readonly busy = new Map<string, number>();
  private readonly reported = new Map<AgentId, boolean>();
  private expiry: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly store: Store,
    private readonly bus: EventBus,
    private readonly notifier: Notifier,
    private readonly timeZone: string,
  ) {}

  private isQuiet(tx: Tx): boolean {
    return tx.peek('day_state', logicalDate(tx.now, this.timeZone))?.quiet_mode ?? false;
  }

  /** The agent carried on, so whatever it was waiting for has been answered. */
  resolve(input: OpInput<'resolve_agent_events'>): { resolved: number } {
    return this.store.write('system', (tx) => {
      const resolved = this.clearWaiting(tx, input.source, input.project ?? null);
      if (resolved > 0) tx.afterCommit(() => this.settle(input.source));
      return { resolved };
    });
  }

  /** Takes down the desktop notification once nothing it said is still waiting. */
  private settle(source: AgentId): void {
    const pending = this.pending();
    if (!pending.some((e) => e.source === source && e.kind === 'needs_input')) {
      this.notifier.withdraw?.(source);
    }
    if (pending.length === 0) this.notifier.withdraw?.('attention-queue');
  }

  /** A prompt or a tool means working; a stopped turn means not. Kept in memory only. */
  activity(input: OpInput<'post_agent_activity'>): { ok: true } {
    const key = `${input.source}\u0000${input.project ?? ''}`;
    if (input.working) this.busy.set(key, this.store.now());
    else this.busy.delete(key);
    this.report();
    clearTimeout(this.expiry);
    if (this.busy.size > 0) {
      this.expiry = setTimeout(() => this.report(), ACTIVITY_MS + 1000);
      this.expiry.unref?.();
    }
    return { ok: true };
  }

  isWorking(source: AgentId): boolean {
    const now = this.store.now();
    for (const [key, at] of this.busy) {
      if (key.startsWith(`${source}\u0000`) && now - at < ACTIVITY_MS) return true;
    }
    return false;
  }

  /** Tells the windows only when an agent's status line would change. */
  private report(): void {
    for (const source of ['claude', 'codex'] as const) {
      const working = this.isWorking(source);
      if ((this.reported.get(source) ?? false) === working) continue;
      this.reported.set(source, working);
      this.bus.publish({ type: 'agent_activity', source, working });
    }
  }

  /** Marks earlier "needs you" events for this agent and project as no longer true. */
  private clearWaiting(tx: Tx, source: AgentId, project: string | null): number {
    const waiting = tx.db
      .select()
      .from(agent_events)
      .where(
        and(
          eq(agent_events.source, source),
          eq(agent_events.kind, 'needs_input'),
          project === null ? isNull(agent_events.project) : eq(agent_events.project, project),
          isNull(agent_events.acknowledged_at),
        ),
      )
      .all();
    for (const event of waiting) {
      tx.update('agent_events', event.id, { acknowledged_at: tx.now });
    }
    return waiting.length;
  }

  post(input: OpInput<'post_agent_event'>): AgentEvent {
    return this.store.write('system', (tx) => {
      const project = input.project ?? null;
      const message = input.message ?? null;
      const quiet = this.isQuiet(tx);

      // "Finished" is news, not a waiting state, so it never sticks around as a toast.
      if (input.kind === 'turn_complete') {
        this.clearWaiting(tx, input.source, project);
        const event = tx.insert('agent_events', {
          source: input.source,
          kind: input.kind,
          project,
          message,
          acknowledged_at: tx.now,
        });
        if (!quiet) tx.afterCommit(() => this.notify(event, input.terminal));
        return event;
      }

      const duplicate = tx.db
        .select()
        .from(agent_events)
        .where(
          and(
            eq(agent_events.source, input.source),
            eq(agent_events.kind, input.kind),
            project === null ? isNull(agent_events.project) : eq(agent_events.project, project),
            isNull(agent_events.acknowledged_at),
          ),
        )
        .get();
      if (duplicate) {
        const quietSince = tx.peek('day_state', logicalDate(tx.now, this.timeZone))?.quiet_since;
        if (quiet && quietSince != null && duplicate.created_at < quietSince) {
          // This is new attention during quiet mode. Retire the earlier event and
          // queue a fresh one, even when the message is identical. Otherwise the
          // old created_at puts it outside releaseSince's window forever.
          tx.update('agent_events', duplicate.id, { acknowledged_at: tx.now });
        } else {
          // One pending event, but a new prompt may deserve another announcement.
          const updated = tx.update('agent_events', duplicate.id, { message });
          if (!quiet) tx.afterCommit(() => this.announce(updated, input.terminal));
          return updated;
        }
      }

      const event = tx.insert('agent_events', {
        source: input.source,
        kind: input.kind,
        project,
        message,
      });
      if (!quiet) tx.afterCommit(() => this.announce(event, input.terminal));
      return event;
    });
  }

  private notify(event: AgentEvent, app?: string): void {
    this.notifier.notify({
      key: event.source,
      title: 'Sirius',
      body: describeAgentEvent(event),
      ...(app ? { app } : {}),
      // "Finished" is news; only a waiting state should stay until it is answered.
      ...(event.kind === 'turn_complete' ? { expireMs: NEWS_MS } : {}),
    });
  }

  private announce(event: AgentEvent, app?: string): void {
    this.bus.publish({ type: 'agent', event });
    this.notify(event, app);
  }

  pending(): AgentEvent[] {
    return this.store.db
      .select()
      .from(agent_events)
      .where(isNull(agent_events.acknowledged_at))
      .orderBy(asc(agent_events.created_at))
      .all();
  }

  ack(id: string): AgentEvent {
    return this.store.write('user', (tx) => {
      const event = tx.update('agent_events', id, { acknowledged_at: tx.now });
      tx.afterCommit(() => this.settle(event.source));
      return event;
    });
  }

  /** Quiet mode ended: show what arrived during it, as one notification rather than a burst. */
  releaseSince(since: number): void {
    const queued = this.store.db
      .select()
      .from(agent_events)
      .where(and(isNull(agent_events.acknowledged_at), gte(agent_events.created_at, since)))
      .orderBy(asc(agent_events.created_at))
      .all();
    const first = queued[0];
    if (!first) return;
    this.bus.publish({ type: 'agent_queue_released', events: queued });
    const body =
      queued.length === 1
        ? describeAgentEvent(first)
        : `${queued.length} things came in during quiet mode.`;
    this.notifier.notify({ key: 'attention-queue', title: 'Sirius', body });
  }
}
