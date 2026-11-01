import type { TaskSource, Via } from '@sirius/contracts';
import { and, eq, isNull, max, sql } from 'drizzle-orm';
import { tasks } from '../db/schema.ts';
import { conflict } from '../errors.ts';
import type { Handlers, OpContext } from './context.ts';
import { completeStep, reopenStep } from './learning.ts';

const SOURCE_BY_VIA: Record<Via, TaskSource> = {
  ui: 'user',
  voice: 'user',
  system: 'user',
  chat: 'sirius',
  mcp: 'mcp',
};

export function sourceFor(via: Via): TaskSource {
  return SOURCE_BY_VIA[via];
}

export function nextTaskPosition(ctx: OpContext, date: string): number {
  const row = ctx.tx.db
    .select({ top: max(tasks.position) })
    .from(tasks)
    .where(eq(tasks.scheduled_for, date))
    .get();
  return (row?.top ?? -1) + 1;
}

export function todayTasks(ctx: OpContext) {
  return ctx.tx.db
    .select()
    .from(tasks)
    .where(
      and(
        eq(tasks.scheduled_for, ctx.today),
        isNull(tasks.deleted_at),
        sql`${tasks.status} != 'dropped'`,
      ),
    )
    .orderBy(tasks.position)
    .all();
}

export function openCountOn(ctx: OpContext, date: string): number {
  const row = ctx.tx.db
    .select({ n: sql<number>`count(*)` })
    .from(tasks)
    .where(and(eq(tasks.scheduled_for, date), eq(tasks.status, 'open'), isNull(tasks.deleted_at)))
    .get();
  return row?.n ?? 0;
}

export const taskHandlers: Handlers<
  | 'add_task'
  | 'complete_task'
  | 'reopen_task'
  | 'reschedule_task'
  | 'rename_task'
  | 'reschedule_tasks'
  | 'drop_task'
  | 'delete_task'
> = {
  add_task({ title, tier, date }, ctx) {
    const scheduled = date ?? ctx.today;
    return ctx.tx.insert('tasks', {
      title,
      tier: tier ?? 'small',
      scheduled_for: scheduled,
      status: 'open',
      position: nextTaskPosition(ctx, scheduled),
      source: sourceFor(ctx.via),
    });
  },

  complete_task({ id }, ctx) {
    const task = ctx.tx.get('tasks', id);
    if (task.status === 'dropped') throw conflict('That task was let go.');
    if (task.roadmap_step_id) completeStep(ctx, task.roadmap_step_id); // F12
    return ctx.tx.update('tasks', id, {
      status: 'done',
      completed_at: task.completed_at ?? ctx.tx.now,
    });
  },

  reopen_task({ id }, ctx) {
    const task = ctx.tx.get('tasks', id);
    if (task.roadmap_step_id) reopenStep(ctx, task.roadmap_step_id);
    return ctx.tx.update('tasks', id, { status: 'open', completed_at: null });
  },

  reschedule_task({ id, date }, ctx) {
    return ctx.tx.update('tasks', id, {
      scheduled_for: date,
      position: nextTaskPosition(ctx, date),
    });
  },

  rename_task({ id, title }, ctx) {
    return ctx.tx.update('tasks', id, { title });
  },

  reschedule_tasks({ ids, date }, ctx) {
    return ids.map((id) =>
      ctx.tx.update('tasks', id, { scheduled_for: date, position: nextTaskPosition(ctx, date) }),
    );
  },

  drop_task({ id }, ctx) {
    return ctx.tx.update('tasks', id, { status: 'dropped' });
  },

  delete_task({ id }, ctx) {
    ctx.tx.softDelete('tasks', id);
    return { ok: true };
  },
};
