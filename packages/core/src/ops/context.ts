import {
  addDays,
  logicalDate,
  type OpName,
  type OpOutput,
  type Ops,
  ops,
  type Via,
} from '@sirius/contracts';
import type { z } from 'zod';
import type { Tx } from '../store.ts';

/** What a domain handler sees. It runs inside the caller's transaction. */
export interface OpContext {
  tx: Tx;
  timeZone: string;
  via: Via;
  /** Logical date: the day rolls over at 04:00 local. */
  today: string;
  hooks: OpHooks;
}

/** Effects a handler can trigger outside the domain, after commit. */
export interface OpHooks {
  /** Quiet mode ended. `since` is when it began; agent events after that were queued. */
  quietEnded(since: number): void;
}

export function makeContext(tx: Tx, timeZone: string, via: Via, hooks: OpHooks): OpContext {
  return { tx, timeZone, via, hooks, today: logicalDate(tx.now, timeZone) };
}

export const tomorrowOf = (ctx: OpContext) => addDays(ctx.today, 1);

export type OpArgs<N extends OpName> = z.output<Ops[N]['input']>;
export type Handler<N extends OpName> = (input: OpArgs<N>, ctx: OpContext) => OpOutput<N>;
export type Handlers<K extends OpName> = { [N in K]: Handler<N> };

/** Parses and runs a domain op against an open transaction. Also how proposals apply. */
export function runInTx(
  handlers: Partial<Handlers<OpName>>,
  name: OpName,
  input: unknown,
  ctx: OpContext,
): unknown {
  const handler = handlers[name] as ((i: unknown, c: OpContext) => unknown) | undefined;
  if (!handler) throw new Error(`No domain handler for ${name}`);
  return handler(ops[name].input.parse(input), ctx);
}
