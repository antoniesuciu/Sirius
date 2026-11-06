/**
 * Server state: React Query kept fresh by SSE (ADR-4). There is no polling. Mutations
 * that need to feel instant update the cache first and reconcile afterwards (F6).
 */
import {
  type EntityName,
  isUnreachable,
  type ListItem,
  type OpInput,
  type OpName,
  type OpOutput,
  type SiriusClient,
  type SiriusEvent,
  type Task,
  type TodayView,
} from '@sirius/contracts';
import {
  type MutateOptions,
  type QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { createContext, useContext } from 'react';

export const ClientContext = createContext<SiriusClient | null>(null);

export function useClient(): SiriusClient {
  const client = useContext(ClientContext);
  if (!client) throw new Error('SiriusClient missing from context');
  return client;
}

/** Each read op is cached under its own name, so a key is never spelled twice. */
function useOpQuery<N extends OpName>(name: N, input: OpInput<N>) {
  const client = useClient();
  return useQuery<OpOutput<N>>({ queryKey: [name], queryFn: () => client.call(name, input) });
}

export const useToday = () => useOpQuery('get_today', {});
export const useGoals = () => useOpQuery('list_goals', {});
export const useLearning = () => useOpQuery('list_learning', {});
export const useReminders = () => useOpQuery('list_reminders', {});
export const useList = () => useOpQuery('get_list', {});
export const useSchedule = () => useOpQuery('list_schedule', {});
export const useProposals = () => useOpQuery('list_proposals', {});
export const useAgents = () => useOpQuery('get_agents', {});
export const useConversation = () => useOpQuery('get_conversation', {});
export const useAgentEvents = () => useOpQuery('list_agent_events', {});
export const useVoiceState = () => useOpQuery('get_voice_state', {});
export const useSettings = () => useOpQuery('get_settings', {});

/** Which cached reads each entity feeds. */
const INVALIDATES: Record<EntityName, OpName[]> = {
  tasks: ['get_today'],
  goals: ['list_goals'],
  milestones: ['list_goals'],
  roadmaps: ['list_learning'],
  roadmap_steps: ['list_learning'],
  reminders: ['list_reminders', 'get_today'],
  list_items: ['get_list'],
  schedule_events: ['list_schedule', 'get_today'],
  day_state: ['get_today', 'get_agents'],
  proposals: ['list_proposals'],
  agent_events: ['list_agent_events', 'get_agents'],
  conversations: ['get_conversation', 'get_agents'],
  messages: ['get_conversation'],
  voice_turns: [],
  settings: ['get_agents', 'get_settings'],
};

export function invalidationsFor(event: SiriusEvent): OpName[] {
  switch (event.type) {
    case 'change':
      return INVALIDATES[event.entity];
    case 'agent':
    case 'agent_queue_released':
      return ['list_agent_events', 'get_agents'];
    case 'agent_activity':
      return ['get_agents'];
    case 'chat':
      if (event.kind === 'start') return ['get_agents'];
      return event.kind === 'done' || event.kind === 'error'
        ? ['get_conversation', 'get_agents']
        : [];
    case 'day_changed':
      return ['get_today', 'list_reminders', 'list_proposals', 'get_agents'];
    default:
      return [];
  }
}

/** A fire-and-forget op that refetches its reads when it settles. */
/**
 * Every change is a queued op (ADR 0010): a plain object naming the op, its input and a key, so
 * it can wait on a phone while the laptop is away, survive a reload, and be sent exactly once.
 */
export interface QueuedOp<A = unknown> {
  op: OpName;
  input: Record<string, unknown>;
  key: string;
  /** What the screen asked for, kept so an optimistic update can be applied from it. */
  arg?: A;
}

export const OP_MUTATION = ['op'] as const;

/** These depend on what the core holds at that moment, so they never wait in a queue. */
const NEEDS_THE_CORE = new Set<OpName>([
  'confirm_proposal',
  'reject_proposal',
  'undo',
  'select_agent',
  'new_conversation',
]);

function newKey(): string {
  return (
    globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
}

/** Registered once, so a change restored after a reload still knows how to send itself. */
export function registerQueuedOps(qc: QueryClient, client: SiriusClient): void {
  qc.setMutationDefaults(OP_MUTATION, {
    mutationFn: (queued: QueuedOp) =>
      client.call(queued.op, queued.input as never, { idempotencyKey: queued.key }),
    // Out of reach is not a refusal: keep trying, and wait while the core is offline.
    retry: (_count, error) => isUnreachable(error),
    retryDelay: 2000,
  });
}

type Options = MutateOptions<unknown, Error, QueuedOp, unknown>;

export function useOp<N extends OpName>(name: N, invalidates: OpName[]) {
  const qc = useQueryClient();
  const live = NEEDS_THE_CORE.has(name);
  const mutation = useMutation<unknown, Error, QueuedOp>({
    mutationKey: OP_MUTATION,
    ...(live ? { networkMode: 'always' as const, retry: false } : {}),
    onSettled: () =>
      Promise.all(invalidates.map((key) => qc.invalidateQueries({ queryKey: [key] }))),
  });
  return {
    ...mutation,
    mutateAsync: (input: OpInput<N>) =>
      mutation.mutateAsync({ op: name, input: input as Record<string, unknown>, key: newKey() }),
    mutate: (input: OpInput<N>, options?: Options) =>
      mutation.mutate(
        { op: name, input: input as Record<string, unknown>, key: newKey() },
        options,
      ),
  };
}

interface TodaySnapshot {
  previous: TodayView | undefined;
}

/** Runs `apply` against the cached day, rolling back if the core refuses the change. */
function useOptimisticToday<A>(
  toOp: (arg: A) => { op: OpName; input: Record<string, unknown> },
  apply: (today: TodayView, arg: A) => TodayView,
) {
  const qc = useQueryClient();
  const key = ['get_today'];
  const mutation = useMutation<unknown, Error, QueuedOp<A>, TodaySnapshot>({
    mutationKey: OP_MUTATION,
    onMutate: ({ arg }) => {
      // Synchronous on purpose: feedback must land inside the 50 ms budget (spec 4.1).
      const previous = qc.getQueryData<TodayView>(key);
      void qc.cancelQueries({ queryKey: key });
      if (previous && arg !== undefined) qc.setQueryData(key, apply(previous, arg));
      return { previous };
    },
    onError: (_error, _queued, snapshot) => {
      if (snapshot?.previous) qc.setQueryData(key, snapshot.previous);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  });
  return { ...mutation, mutate: (arg: A) => mutation.mutate({ ...toOp(arg), key: newKey(), arg }) };
}

function placeholderTask(title: string, date: string): Task {
  const now = Date.now();
  return {
    id: `optimistic-${now}`,
    created_at: now,
    updated_at: now,
    deleted_at: null,
    rev: 0,
    title,
    tier: 'small',
    scheduled_for: date,
    status: 'open',
    position: Number.MAX_SAFE_INTEGER,
    completed_at: null,
    source: 'user',
    roadmap_step_id: null,
  };
}

export function useAddTask() {
  return useOptimisticToday(
    (title: string) => ({ op: 'add_task', input: { title } }),
    (today, title) => ({ ...today, tasks: [...today.tasks, placeholderTask(title, today.date)] }),
  );
}

export function useToggleTask() {
  return useOptimisticToday(
    (task: Task) => ({
      op: task.status === 'done' ? 'reopen_task' : 'complete_task',
      input: { id: task.id },
    }),
    (today, task) => ({
      ...today,
      tasks: today.tasks.map((t) =>
        t.id === task.id
          ? {
              ...t,
              status: task.status === 'done' ? 'open' : 'done',
              completed_at: task.status === 'done' ? null : Date.now(),
            }
          : t,
      ),
    }),
  );
}

export function useDropTask() {
  return useOptimisticToday(
    (task: Task) => ({ op: 'drop_task', input: { id: task.id } }),
    (today, task) => ({ ...today, tasks: today.tasks.filter((t) => t.id !== task.id) }),
  );
}

export function useSetQuiet() {
  return useOptimisticToday(
    (on: boolean) => ({ op: 'set_quiet_mode', input: { on } }),
    (today, on) => ({ ...today, quiet_mode: on }),
  );
}

/** The list ticks off at once, and gets its item back if the core refuses (F35). */
export function useTickListItem() {
  const qc = useQueryClient();
  const key = ['get_list'];
  const mutation = useMutation<unknown, Error, QueuedOp, { previous: ListItem[] | undefined }>({
    mutationKey: OP_MUTATION,
    onMutate: ({ input }) => {
      const previous = qc.getQueryData<ListItem[]>(key);
      void qc.cancelQueries({ queryKey: key });
      if (previous)
        qc.setQueryData(
          key,
          previous.filter((item) => item.id !== input.id),
        );
      return { previous };
    },
    onError: (_error, _queued, snapshot) => {
      if (snapshot?.previous) qc.setQueryData(key, snapshot.previous);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  });
  return {
    ...mutation,
    mutate: (item: ListItem) =>
      mutation.mutate({ op: 'tick_list_item', input: { id: item.id }, key: newKey() }),
  };
}

/** Shows at once, like a task, and is replaced by the real item when the core answers. */
export function useAddToList() {
  const qc = useQueryClient();
  const key = ['get_list'];
  const mutation = useMutation<unknown, Error, QueuedOp, { previous: ListItem[] | undefined }>({
    mutationKey: OP_MUTATION,
    onMutate: ({ input }) => {
      const previous = qc.getQueryData<ListItem[]>(key);
      void qc.cancelQueries({ queryKey: key });
      const now = Date.now();
      const placeholder: ListItem = {
        id: `optimistic-${now}`,
        created_at: now,
        updated_at: now,
        deleted_at: null,
        rev: 0,
        text: String(input.text),
        done_at: null,
      };
      qc.setQueryData(key, [...(previous ?? []), placeholder]);
      return { previous };
    },
    onError: (_error, _queued, snapshot) => {
      if (snapshot) qc.setQueryData(key, snapshot.previous);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  });
  return {
    ...mutation,
    mutate: (text: string) =>
      mutation.mutate({ op: 'add_to_list', input: { text }, key: newKey() }),
  };
}
