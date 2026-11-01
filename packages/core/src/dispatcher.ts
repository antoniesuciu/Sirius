/**
 * The one way in: REST, MCP, proposals and the fast voice path all land here. This is
 * where ADR-7 lives. Classification comes from the registry and is enforced here, so
 * no prompt, adapter or client can talk its way past it.
 */
import {
  type Actor,
  type OpDefinition,
  type OpName,
  type OpOutput,
  ops,
  type Via,
} from '@sirius/contracts';
import { and, gt, inArray, ne, sql } from 'drizzle-orm';
import { change_log } from './db/schema.ts';
import { forbidden, requiresProposal } from './errors.ts';
import { makeContext, type OpHooks, runInTx } from './ops/context.ts';
import { type DomainOp, domainHandlers, isDomainOp } from './ops/index.ts';
import type { Store } from './store.ts';

export interface Caller {
  actor: Actor;
  via: Via;
}

export type SystemOp = Exclude<OpName, DomainOp>;

/** Operations that are not domain changes, so each manages its own transaction. */
export type SystemHandlers = {
  // Inputs are `any` because the dispatcher has already parsed them against the registry.
  [N in SystemOp]: (input: any, caller: Caller) => OpOutput<N>;
};

/**
 * F19 limits one operation to one existing item, but an agent could still make twenty
 * single edits in a row and never trigger a proposal. Past this many edits a minute it
 * has to propose instead (docs/adr/0002-agent-edit-limit.md).
 */
export const AGENT_EDITS_PER_MINUTE = 5;
const EDIT_WINDOW_MS = 60_000;

const isAgent = (actor: Actor) => actor === 'claude' || actor === 'codex';

/** Additive ops that take an `id` edit something that already exists. */
function editsExistingItem(def: OpDefinition): boolean {
  return def.class === 'additive' && 'id' in def.input.shape;
}

export class Dispatcher {
  constructor(
    private readonly store: Store,
    private readonly timeZone: string,
    private readonly system: SystemHandlers,
    private readonly hooks: OpHooks,
  ) {}

  run<N extends OpName>(name: N, rawInput: unknown, caller: Caller): OpOutput<N> {
    const def = ops[name] as OpDefinition;
    this.authorize(name, def, caller);

    if (isDomainOp(name)) {
      return this.store.write(caller.actor, (tx) =>
        runInTx(
          domainHandlers,
          name,
          rawInput,
          makeContext(tx, this.timeZone, caller.via, this.hooks),
        ),
      ) as OpOutput<N>;
    }
    const handler = this.system[name as SystemOp];
    return handler(def.input.parse(rawInput), caller) as OpOutput<N>;
  }

  private authorize(name: OpName, def: OpDefinition, caller: Caller): void {
    if (!isAgent(caller.actor)) return;
    if (def.userOnly) throw forbidden(`${name} is only available to the user.`);
    if (def.class === 'bulk_or_destructive') {
      throw requiresProposal(`${name} changes several items or deletes something.`);
    }
    if (editsExistingItem(def) && this.recentAgentEdits() >= AGENT_EDITS_PER_MINUTE) {
      throw requiresProposal('That is a lot of edits in a row.');
    }
  }

  /** Counts operations, not rows: completing a task can touch its step and roadmap too. */
  private recentAgentEdits(): number {
    const row = this.store.db
      .select({ n: sql<number>`count(distinct ${change_log.batch_id})` })
      .from(change_log)
      .where(
        and(
          gt(change_log.at, this.store.now() - EDIT_WINDOW_MS),
          inArray(change_log.actor, ['claude', 'codex']),
          inArray(change_log.op, ['update', 'delete']),
          ne(change_log.entity, 'proposals'),
        ),
      )
      .get();
    return row?.n ?? 0;
  }
}
