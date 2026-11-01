/** Agent attention (F23–F25): record, coalesce, notify, and queue through quiet mode. */
import { type AgentEvent, describeAgentEvent, logicalDate, type OpInput } from '@sirius/contracts';
import { and, asc, eq, gte, isNull } from 'drizzle-orm';
import type { EventBus } from '../bus.ts';
import { agent_events } from '../db/schema.ts';
import type { Notifier } from '../notifier.ts';
import type { Store, Tx } from '../store.ts';

export class Attention {
  constructor(
    private readonly store: Store,
    private readonly bus: EventBus,
    private readonly notifier: Notifier,
    private readonly timeZone: string,
  ) {}

  private isQuiet(tx: Tx): boolean {
    return tx.peek('day_state', logicalDate(tx.now, this.timeZone))?.quiet_mode ?? false;
  }

  post(input: OpInput<'post_agent_event'>): AgentEvent {
    return this.store.write('system', (tx) => {
      const project = input.project ?? null;
      const message = input.message ?? null;
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
      if (duplicate) return tx.update('agent_events', duplicate.id, { message });

      const event = tx.insert('agent_events', {
        source: input.source,
        kind: input.kind,
        project,
        message,
      });
      if (!this.isQuiet(tx)) tx.afterCommit(() => this.announce(event));
      return event;
    });
  }

  private announce(event: AgentEvent): void {
    this.bus.publish({ type: 'agent', event });
    this.notifier.notify({ key: event.source, title: 'Sirius', body: describeAgentEvent(event) });
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
    return this.store.write('user', (tx) =>
      tx.update('agent_events', id, { acknowledged_at: tx.now }),
    );
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
        : `${queued.length} things came in while you were away. No rush.`;
    this.notifier.notify({ key: 'attention-queue', title: 'Sirius', body });
  }
}
