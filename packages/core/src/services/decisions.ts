/** The user's side of F19 and F20: confirm or reject a proposal, undo a change. */
import type { OpOutput, Proposal, Via } from '@sirius/contracts';
import { asc, eq } from 'drizzle-orm';
import { change_log } from '../db/schema.ts';
import { conflict, DomainError, notFound } from '../errors.ts';
import { makeContext, type OpHooks, runInTx } from '../ops/context.ts';
import { domainHandlers } from '../ops/index.ts';
import type { Entity, Store } from '../store.ts';

export const UNDO_WINDOW_MS = 30_000;

export class Decisions {
  constructor(
    private readonly store: Store,
    private readonly timeZone: string,
    private readonly hooks: OpHooks,
  ) {}

  private pending(id: string): Proposal {
    const proposal = this.store.write('user', (tx) => tx.get('proposals', id));
    if (proposal.status !== 'pending') throw conflict('That proposal was already decided.');
    return proposal;
  }

  /** Applies every op in one transaction, attributed to the agent that proposed them. */
  confirm(id: string, via: Via): OpOutput<'confirm_proposal'> {
    const proposal = this.pending(id);
    try {
      if (proposal.expires_at <= this.store.now()) throw conflict('That proposal has expired.');
      const applied = this.store.write('user', (tx) => {
        const ctx = makeContext(tx, this.timeZone, via, this.hooks);
        tx.as(proposal.actor, () => {
          for (const { op, input } of proposal.ops) {
            runInTx(domainHandlers, op as never, input, ctx);
          }
        });
        return tx.update('proposals', id, { status: 'applied', decided_at: tx.now });
      });
      return { ok: true, proposal: applied };
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;
      this.store.write('user', (tx) =>
        tx.update('proposals', id, { status: 'expired', decided_at: tx.now }),
      );
      throw conflict('Something changed since then, so nothing was applied.');
    }
  }

  reject(id: string): OpOutput<'reject_proposal'> {
    this.pending(id);
    const proposal = this.store.write('user', (tx) =>
      tx.update('proposals', id, { status: 'rejected', decided_at: tx.now }),
    );
    return { ok: true, proposal };
  }

  /** Reverts every row of the batch `changeId` belongs to, or nothing at all. */
  undo(changeId: string): OpOutput<'undo'> {
    return this.store.write('user', (tx) => {
      const change = tx.db.select().from(change_log).where(eq(change_log.id, changeId)).get();
      if (!change) throw notFound('Change');
      if (tx.now - change.at > UNDO_WINDOW_MS) {
        throw new DomainError(410, 'undo_expired', 'That can no longer be undone.');
      }
      const rows = tx.db
        .select()
        .from(change_log)
        .where(eq(change_log.batch_id, change.batch_id))
        .orderBy(asc(change_log.id))
        .all()
        // A proposal stays decided: undoing its effect must not offer Confirm again.
        .filter((r) => r.entity !== 'proposals');

      // A row may change twice in a batch: restore its earliest state, but require
      // that nothing else touched it after the batch's last write.
      type Log = (typeof rows)[number];
      const touched = new Map<string, { first: Log; last: Log }>();
      for (const row of rows) {
        const key = `${row.entity}:${row.entity_id}`;
        const seen = touched.get(key);
        if (seen) seen.last = row;
        else touched.set(key, { first: row, last: row });
      }
      for (const { first, last } of touched.values()) {
        const entity = first.entity as Entity;
        const current = tx.peek(entity, first.entity_id);
        if (!current || current.rev !== last.payload.after.rev) {
          throw conflict('That has changed since, so I left it alone.');
        }
        const before = first.payload.before;
        tx.restore(entity, current, before ?? { deleted_at: tx.now });
      }
      return { ok: true, reverted: touched.size };
    });
  }
}
