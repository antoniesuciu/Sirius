import type { OpInput, OpName, OpOutput, SiriusEvent } from '@sirius/contracts';
import { type Core, createCore } from '../src/core.ts';
import type { Caller } from '../src/dispatcher.ts';
import type { Notification } from '../src/notifier.ts';

/** Sunday 1 Nov 2026, 15:45 in Lisbon (UTC+0 in winter). */
export const NOON_ISH = Date.parse('2026-11-01T15:45:00Z');
export const TZ = 'Europe/Lisbon';
export const USER: Caller = { actor: 'user', via: 'ui' };
export const CLAUDE: Caller = { actor: 'claude', via: 'chat' };

export interface Harness {
  core: Core;
  notified: Notification[];
  events: SiriusEvent[];
  now: { value: number };
  advance(ms: number): void;
  run<N extends OpName>(name: N, input: OpInput<N>, caller?: Caller): OpOutput<N>;
}

export function harness(start = NOON_ISH): Harness {
  const now = { value: start };
  const notified: Notification[] = [];
  const events: SiriusEvent[] = [];
  const core = createCore({
    dbPath: ':memory:',
    timeZone: TZ,
    clock: () => now.value,
    notifier: { notify: (n) => notified.push(n) },
  });
  core.bus.subscribe((e) => events.push(e));
  return {
    core,
    notified,
    events,
    now,
    advance: (ms) => {
      now.value += ms;
    },
    run: (name, input, caller = USER) => core.dispatcher.run(name, input, caller),
  };
}

/** Asserts on the error code, which is the contract, not the wording. */
export function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    return (error as { code?: string }).code ?? (error as Error).name;
  }
  return undefined;
}
