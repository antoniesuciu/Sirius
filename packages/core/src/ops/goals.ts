import type { GoalView } from '@sirius/contracts';
import { and, asc, eq, isNull, max } from 'drizzle-orm';
import { goals, milestones } from '../db/schema.ts';
import type { Handlers, OpContext } from './context.ts';

function goalMilestones(ctx: OpContext, goalId: string) {
  return ctx.tx.db
    .select()
    .from(milestones)
    .where(and(eq(milestones.goal_id, goalId), isNull(milestones.deleted_at)))
    .orderBy(asc(milestones.position))
    .all();
}

function nextPosition(ctx: OpContext, goalId: string): number {
  const row = ctx.tx.db
    .select({ top: max(milestones.position) })
    .from(milestones)
    .where(eq(milestones.goal_id, goalId))
    .get();
  return (row?.top ?? -1) + 1;
}

export const goalHandlers: Handlers<
  | 'list_goals'
  | 'add_goal'
  | 'rename_goal'
  | 'delete_goal'
  | 'add_milestone'
  | 'complete_milestone'
  | 'reopen_milestone'
  | 'delete_milestone'
> = {
  list_goals(_input, ctx): GoalView[] {
    return ctx.tx.db
      .select()
      .from(goals)
      .where(isNull(goals.deleted_at))
      .orderBy(asc(goals.position))
      .all()
      .map((goal) => ({ ...goal, milestones: goalMilestones(ctx, goal.id) }));
  },

  add_goal({ title, horizon_text, target_date, milestones: drafts }, ctx) {
    const top = ctx.tx.db
      .select({ top: max(goals.position) })
      .from(goals)
      .get();
    const goal = ctx.tx.insert('goals', {
      title,
      horizon_text: horizon_text ?? null,
      target_date: target_date ?? null,
      status: 'active',
      position: (top?.top ?? -1) + 1,
    });
    const rows = (drafts ?? []).map((draft, position) =>
      ctx.tx.insert('milestones', { goal_id: goal.id, title: draft.title, position }),
    );
    return { ...goal, milestones: rows };
  },

  rename_goal({ id, title }, ctx) {
    return ctx.tx.update('goals', id, { title });
  },

  delete_goal({ id }, ctx) {
    for (const milestone of goalMilestones(ctx, id)) ctx.tx.softDelete('milestones', milestone.id);
    ctx.tx.softDelete('goals', id);
    return { ok: true };
  },

  add_milestone({ goal_id, title }, ctx) {
    ctx.tx.get('goals', goal_id);
    return ctx.tx.insert('milestones', { goal_id, title, position: nextPosition(ctx, goal_id) });
  },

  complete_milestone({ id }, ctx) {
    const milestone = ctx.tx.get('milestones', id);
    return ctx.tx.update('milestones', id, { done_at: milestone.done_at ?? ctx.tx.now });
  },

  reopen_milestone({ id }, ctx) {
    return ctx.tx.update('milestones', id, { done_at: null });
  },

  delete_milestone({ id }, ctx) {
    ctx.tx.softDelete('milestones', id);
    return { ok: true };
  },
};
