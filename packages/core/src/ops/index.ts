import type { OpName } from '@sirius/contracts';
import type { Handlers } from './context.ts';
import { dayHandlers } from './day.ts';
import { goalHandlers } from './goals.ts';
import { learningHandlers } from './learning.ts';
import { reminderHandlers } from './reminders.ts';
import { taskHandlers } from './tasks.ts';

/** Handlers that run inside the caller's transaction. Everything else is a service. */
export const domainHandlers = {
  ...taskHandlers,
  ...goalHandlers,
  ...learningHandlers,
  ...reminderHandlers,
  ...dayHandlers,
} satisfies Partial<Handlers<OpName>>;

export type DomainOp = keyof typeof domainHandlers;

export function isDomainOp(name: OpName): name is DomainOp {
  return Object.hasOwn(domainHandlers, name);
}
