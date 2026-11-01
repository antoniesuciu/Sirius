/**
 * The write path. Every mutation goes through a `Tx`, which is what makes ADR-3 hold
 * by construction: ops cannot forget to bump `rev`, stamp `updated_at`, write the change
 * log or publish an SSE event, because they never touch those fields themselves.
 */
import type { Actor, ChangeEvent, ChangeOp, EntityName } from '@sirius/contracts';
import { eq } from 'drizzle-orm';
import type { EventBus } from './bus.ts';
import * as schema from './db/schema.ts';
import { notFound } from './errors.ts';
import type { Db } from './runtime/sqlite.ts';
import { uuidv7 } from './uuid.ts';

const entities = {
  tasks: { table: schema.tasks, pk: schema.tasks.id },
  goals: { table: schema.goals, pk: schema.goals.id },
  milestones: { table: schema.milestones, pk: schema.milestones.id },
  roadmaps: { table: schema.roadmaps, pk: schema.roadmaps.id },
  roadmap_steps: { table: schema.roadmap_steps, pk: schema.roadmap_steps.id },
  reminders: { table: schema.reminders, pk: schema.reminders.id },
  day_state: { table: schema.day_state, pk: schema.day_state.date },
  proposals: { table: schema.proposals, pk: schema.proposals.id },
  agent_events: { table: schema.agent_events, pk: schema.agent_events.id },
  conversations: { table: schema.conversations, pk: schema.conversations.id },
  messages: { table: schema.messages, pk: schema.messages.id },
  voice_turns: { table: schema.voice_turns, pk: schema.voice_turns.id },
  settings: { table: schema.settings, pk: schema.settings.key },
} as const;

type Entities = typeof entities;
export type Entity = keyof Entities & EntityName;
export type Row<E extends Entity> = Entities[E]['table']['$inferSelect'];
type Stamped = 'created_at' | 'updated_at' | 'deleted_at' | 'rev';
/** What an op provides: everything but the stamps. `id` is generated unless given. */
export type Insert<E extends Entity> = Omit<
  Entities[E]['table']['$inferInsert'],
  Stamped | 'id'
> & {
  id?: string;
};
export type Patch<E extends Entity> = Partial<Omit<Row<E>, Stamped | 'id' | 'key' | 'date'>>;

type AnyRow = Record<string, unknown>;

export class Tx {
  private readonly events: ChangeEvent[] = [];
  private readonly effects: Array<() => void> = [];

  constructor(
    /** Direct query access for reads. Writes go through the methods below. */
    readonly db: Db,
    readonly now: number,
    private currentActor: Actor,
    readonly batchId: string,
  ) {}

  get actor(): Actor {
    return this.currentActor;
  }

  /** Attributes the writes in `fn` to someone else: a confirmed proposal is the agent's change. */
  as<T>(actor: Actor, fn: () => T): T {
    const previous = this.currentActor;
    this.currentActor = actor;
    try {
      return fn();
    } finally {
      this.currentActor = previous;
    }
  }

  private pkOf(entity: Entity, row: AnyRow): string {
    return String(row[entities[entity].pk.name]);
  }

  private log(entity: Entity, op: ChangeOp, before: AnyRow | null, after: AnyRow): void {
    const id = uuidv7(this.now);
    const entityId = this.pkOf(entity, after);
    this.db
      .insert(schema.change_log)
      .values({
        id,
        batch_id: this.batchId,
        entity,
        entity_id: entityId,
        op,
        actor: this.currentActor,
        payload: { before, after },
        at: this.now,
      })
      .run();
    this.events.push({
      type: 'change',
      entity,
      id: entityId,
      op,
      rev: after.rev as number,
      actor: this.currentActor,
      change_id: id,
    });
  }

  /** Reads one row, soft-deleted or not. */
  peek<E extends Entity>(entity: E, id: string): Row<E> | undefined {
    const { table, pk } = entities[entity];
    return this.db
      .select()
      .from(table as never)
      .where(eq(pk, id))
      .get() as Row<E> | undefined;
  }

  /** Reads one live row, or throws a 404. */
  get<E extends Entity>(entity: E, id: string): Row<E> {
    const row = this.peek(entity, id);
    if (!row || (row as AnyRow).deleted_at != null) throw notFound(entity);
    return row;
  }

  insert<E extends Entity>(entity: E, values: Insert<E>): Row<E> {
    const { table, pk } = entities[entity];
    const stamped: AnyRow = {
      ...values,
      created_at: this.now,
      updated_at: this.now,
      deleted_at: null,
      rev: 1,
    };
    if (pk.name === 'id') stamped.id = (values as AnyRow).id ?? uuidv7(this.now);
    const row = this.db
      .insert(table as never)
      .values(stamped as never)
      .returning()
      .get() as unknown as AnyRow;
    this.log(entity, 'create', null, row);
    return row as Row<E>;
  }

  /** Skips the write when nothing changes, so idempotent calls leave no trace. */
  update<E extends Entity>(entity: E, id: string, patch: Patch<E>): Row<E> {
    return this.write(entity, this.get(entity, id), patch as AnyRow, 'update');
  }

  softDelete<E extends Entity>(entity: E, id: string): Row<E> {
    return this.write(entity, this.get(entity, id), { deleted_at: this.now }, 'delete');
  }

  /** Writes a whole earlier state back, including onto a soft-deleted row (undo). */
  restore<E extends Entity>(entity: E, current: Row<E>, state: AnyRow): Row<E> {
    const { created_at: _c, updated_at: _u, rev: _r, ...fields } = state;
    return this.write(entity, current, fields, 'update');
  }

  private write<E extends Entity>(entity: E, current: Row<E>, patch: AnyRow, op: ChangeOp): Row<E> {
    const before = current as AnyRow;
    const changed = Object.keys(patch).some(
      (k) => JSON.stringify(patch[k]) !== JSON.stringify(before[k]),
    );
    if (!changed) return current;
    const { table, pk } = entities[entity];
    const row = this.db
      .update(table as never)
      .set({ ...patch, updated_at: this.now, rev: (before.rev as number) + 1 } as never)
      .where(eq(pk, this.pkOf(entity, before)))
      .returning()
      .get() as unknown as AnyRow;
    this.log(entity, op, before, row);
    return row as Row<E>;
  }

  /** Runs once the transaction has committed. Used for notifications and the like. */
  afterCommit(effect: () => void): void {
    this.effects.push(effect);
  }

  /** @internal Called by Store after commit. */
  flush(bus: EventBus): void {
    for (const event of this.events) bus.publish(event);
    for (const effect of this.effects) effect();
  }
}

export class Store {
  constructor(
    readonly db: Db,
    private readonly bus: EventBus,
    private readonly clock: () => number,
  ) {}

  now(): number {
    return this.clock();
  }

  /**
   * Runs `fn` in one transaction. Events and effects are held until commit, so a
   * rolled-back write is never announced. bun:sqlite is synchronous, so `fn` must be too.
   */
  write<T>(actor: Actor, fn: (tx: Tx) => T): T {
    const now = this.clock();
    let captured: Tx | undefined;
    const result = this.db.transaction((inner) => {
      captured = new Tx(inner as unknown as Db, now, actor, uuidv7(now));
      return fn(captured);
    });
    captured?.flush(this.bus);
    return result;
  }
}
