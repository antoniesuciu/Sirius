/**
 * Server state: React Query kept fresh by SSE (ADR-4). There is no polling. Mutations
 * that need to feel instant update the cache first and reconcile afterwards (F6).
 */
import type {
  EntityName,
  OpInput,
  OpName,
  OpOutput,
  SiriusClient,
  SiriusEvent,
  Task,
  TodayView,
} from '@sirius/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
    case 'chat':
      return event.kind === 'done' || event.kind === 'error'
        ? ['get_conversation', 'get_agents']
        : [];
    default:
      return [];
  }
}

/** A fire-and-forget op that refetches its reads when it settles. */
export function useOp<N extends OpName>(name: N, invalidates: OpName[]) {
  const client = useClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: OpInput<N>) => client.call(name, input),
    onSettled: () =>
      Promise.all(invalidates.map((key) => qc.invalidateQueries({ queryKey: [key] }))),
  });
}

interface TodaySnapshot {
  previous: TodayView | undefined;
}

/** Runs `apply` against the cached day, rolling back if the request fails. */
function useOptimisticToday<I>(
  mutationFn: (input: I) => Promise<unknown>,
  apply: (today: TodayView, input: I) => TodayView,
) {
  const qc = useQueryClient();
  const key = ['get_today'];
  return useMutation<unknown, Error, I, TodaySnapshot>({
    mutationFn,
    onMutate: (input) => {
      // Synchronous on purpose: feedback must land inside the 50 ms budget (spec 4.1).
      const previous = qc.getQueryData<TodayView>(key);
      void qc.cancelQueries({ queryKey: key });
      if (previous) qc.setQueryData(key, apply(previous, input));
      return { previous };
    },
    onError: (_error, _input, snapshot) => {
      if (snapshot?.previous) qc.setQueryData(key, snapshot.previous);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  });
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
  const client = useClient();
  return useOptimisticToday(
    (title: string) => client.call('add_task', { title }),
    (today, title) => ({ ...today, tasks: [...today.tasks, placeholderTask(title, today.date)] }),
  );
}

export function useToggleTask() {
  const client = useClient();
  return useOptimisticToday(
    (task: Task) =>
      client.call(task.status === 'done' ? 'reopen_task' : 'complete_task', { id: task.id }),
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
  const client = useClient();
  return useOptimisticToday(
    (task: Task) => client.call('drop_task', { id: task.id }),
    (today, task) => ({ ...today, tasks: today.tasks.filter((t) => t.id !== task.id) }),
  );
}

export function useSetQuiet() {
  const client = useClient();
  return useOptimisticToday(
    (on: boolean) => client.call('set_quiet_mode', { on }),
    (today, on) => ({ ...today, quiet_mode: on }),
  );
}
