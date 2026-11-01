import type { RoadmapView } from '@sirius/contracts';
import { and, asc, eq, isNull, max } from 'drizzle-orm';
import { roadmap_steps, roadmaps, tasks } from '../db/schema.ts';
import type { Handlers, OpContext } from './context.ts';
import { nextTaskPosition } from './tasks.ts';

function stepsOf(ctx: OpContext, roadmapId: string) {
  return ctx.tx.db
    .select()
    .from(roadmap_steps)
    .where(and(eq(roadmap_steps.roadmap_id, roadmapId), isNull(roadmap_steps.deleted_at)))
    .orderBy(asc(roadmap_steps.position))
    .all();
}

function allRoadmaps(ctx: OpContext) {
  return ctx.tx.db
    .select()
    .from(roadmaps)
    .where(isNull(roadmaps.deleted_at))
    .orderBy(asc(roadmaps.position))
    .all();
}

/**
 * Finishing a roadmap's last step finishes the roadmap and moves the path on to the
 * next one. Without this the vine would stop forever at a finished roadmap, since
 * no operation changes a roadmap's status directly.
 */
export function completeStep(ctx: OpContext, stepId: string): void {
  const step = ctx.tx.peek('roadmap_steps', stepId);
  if (!step || step.deleted_at !== null) return;
  ctx.tx.update('roadmap_steps', stepId, { status: 'done', done_at: step.done_at ?? ctx.tx.now });
  if (stepsOf(ctx, step.roadmap_id).some((s) => s.status === 'todo')) return;
  ctx.tx.update('roadmaps', step.roadmap_id, { status: 'done' });
  const list = allRoadmaps(ctx);
  if (list.some((r) => r.status === 'active')) return;
  const next = list.find((r) => r.status === 'later');
  if (next) ctx.tx.update('roadmaps', next.id, { status: 'active' });
}

export function reopenStep(ctx: OpContext, stepId: string): void {
  const step = ctx.tx.peek('roadmap_steps', stepId);
  if (!step || step.deleted_at !== null) return;
  ctx.tx.update('roadmap_steps', stepId, { status: 'todo', done_at: null });
  const roadmap = ctx.tx.get('roadmaps', step.roadmap_id);
  if (roadmap.status === 'done') ctx.tx.update('roadmaps', roadmap.id, { status: 'active' });
}

export const learningHandlers: Handlers<
  | 'list_learning'
  | 'add_roadmap'
  | 'rename_roadmap'
  | 'delete_roadmap'
  | 'add_roadmap_step'
  | 'step_to_today'
  | 'delete_roadmap_step'
> = {
  list_learning(_input, ctx): RoadmapView[] {
    return allRoadmaps(ctx).map((r) => ({ ...r, steps: stepsOf(ctx, r.id) }));
  },

  add_roadmap({ title, subtitle, steps }, ctx) {
    const list = allRoadmaps(ctx);
    const roadmap = ctx.tx.insert('roadmaps', {
      title,
      subtitle: subtitle ?? null,
      // The first roadmap becomes current; the rest wait their turn on the path.
      status: list.some((r) => r.status === 'active') ? 'later' : 'active',
      position: (list.at(-1)?.position ?? -1) + 1,
    });
    const rows = (steps ?? []).map((draft, position) =>
      ctx.tx.insert('roadmap_steps', {
        roadmap_id: roadmap.id,
        title: draft.title,
        est_minutes: draft.est_minutes ?? null,
        position,
        status: 'todo',
      }),
    );
    return { ...roadmap, steps: rows };
  },

  rename_roadmap({ id, title }, ctx) {
    return ctx.tx.update('roadmaps', id, { title });
  },

  delete_roadmap({ id }, ctx) {
    for (const step of stepsOf(ctx, id)) ctx.tx.softDelete('roadmap_steps', step.id);
    ctx.tx.softDelete('roadmaps', id);
    return { ok: true };
  },

  add_roadmap_step({ roadmap_id, title, est_minutes }, ctx) {
    ctx.tx.get('roadmaps', roadmap_id);
    const top = ctx.tx.db
      .select({ top: max(roadmap_steps.position) })
      .from(roadmap_steps)
      .where(eq(roadmap_steps.roadmap_id, roadmap_id))
      .get();
    return ctx.tx.insert('roadmap_steps', {
      roadmap_id,
      title,
      est_minutes: est_minutes ?? null,
      position: (top?.top ?? -1) + 1,
      status: 'todo',
    });
  },

  step_to_today({ id }, ctx) {
    const step = ctx.tx.get('roadmap_steps', id);
    const linked = ctx.tx.db
      .select()
      .from(tasks)
      .where(and(eq(tasks.roadmap_step_id, id), eq(tasks.status, 'open'), isNull(tasks.deleted_at)))
      .get();
    if (linked) {
      if (linked.scheduled_for === ctx.today) return linked;
      return ctx.tx.update('tasks', linked.id, {
        scheduled_for: ctx.today,
        position: nextTaskPosition(ctx, ctx.today),
      });
    }
    return ctx.tx.insert('tasks', {
      title: step.est_minutes ? `${step.title}, ${step.est_minutes} minutes` : step.title,
      tier: 'small',
      scheduled_for: ctx.today,
      status: 'open',
      position: nextTaskPosition(ctx, ctx.today),
      source: 'roadmap',
      roadmap_step_id: id,
    });
  },

  delete_roadmap_step({ id }, ctx) {
    ctx.tx.softDelete('roadmap_steps', id);
    return { ok: true };
  },
};
