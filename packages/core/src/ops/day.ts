import { addDays, isProposable, ops, zonedInstant } from '@sirius/contracts';
import { eq } from 'drizzle-orm';
import { proposals } from '../db/schema.ts';
import { DomainError, forbidden } from '../errors.ts';
import { type Handlers, type OpContext, tomorrowOf } from './context.ts';
import { allReminders } from './reminders.ts';
import { scheduleOn } from './schedule.ts';
import { openCountOn, todayTasks } from './tasks.ts';

export function isQuiet(ctx: OpContext): boolean {
  return ctx.tx.peek('day_state', ctx.today)?.quiet_mode ?? false;
}

export function setQuiet(ctx: OpContext, on: boolean): void {
  const row = ctx.tx.peek('day_state', ctx.today);
  const quiet_since = on ? ctx.tx.now : null;
  if (row) ctx.tx.update('day_state', ctx.today, { quiet_mode: on, quiet_since });
  else ctx.tx.insert('day_state', { date: ctx.today, quiet_mode: on, quiet_since });
}

export const dayHandlers: Handlers<
  'get_today' | 'list_proposals' | 'propose_changes' | 'set_quiet_mode'
> = {
  set_quiet_mode({ on }, ctx) {
    const since = ctx.tx.peek('day_state', ctx.today)?.quiet_since ?? null;
    setQuiet(ctx, on);
    if (!on && since !== null) ctx.tx.afterCommit(() => ctx.hooks.quietEnded(since));
    return { quiet_mode: on };
  },

  get_today(_input, ctx) {
    const upcoming = allReminders(ctx)
      .filter((r) => r.next_fire_at !== null)
      .sort((a, b) => (a.next_fire_at ?? 0) - (b.next_fire_at ?? 0));
    return {
      date: ctx.today,
      tasks: todayTasks(ctx),
      quiet_mode: isQuiet(ctx),
      next_reminder: upcoming[0] ?? null,
      resting_tomorrow: openCountOn(ctx, tomorrowOf(ctx)),
      schedule: scheduleOn(ctx, ctx.today),
    };
  },

  list_proposals(_input, ctx) {
    return ctx.tx.db.select().from(proposals).where(eq(proposals.status, 'pending')).all();
  },

  /** Validated in full now, so a malformed proposal never reaches the user's Confirm card. */
  propose_changes({ summary, ops: proposed }, ctx) {
    const actor = ctx.tx.actor;
    if (actor !== 'claude' && actor !== 'codex') {
      throw forbidden('Only an agent proposes changes. The user can just make them.');
    }
    for (const { op, input } of proposed) {
      if (!isProposable(op)) {
        throw new DomainError(400, 'invalid_proposal', `${op} cannot be part of a proposal.`);
      }
      const parsed = ops[op].input.safeParse(input);
      if (!parsed.success) {
        throw new DomainError(400, 'invalid_proposal', `${op}: ${parsed.error.message}`);
      }
    }
    return ctx.tx.insert('proposals', {
      actor,
      summary,
      ops: proposed,
      status: 'pending',
      // Plans go stale overnight, so a proposal lives until the next rollover.
      expires_at: zonedInstant(addDays(ctx.today, 1), '04:00', ctx.timeZone),
    });
  },
};
