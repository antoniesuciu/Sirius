import {
  type AgentId,
  agentCatalog,
  buildSuggestions,
  describeAgentEvent,
  greeting,
  type Proposal,
  type ReminderView,
} from '@sirius/contracts';
import {
  AgentToast,
  type AvatarState,
  type ChatLine,
  GoalsPanel,
  Header,
  LearningPanel,
  Leaves,
  nextStep,
  PersonalPanel,
  SiriusPanel,
  TodayPanel,
  usePageHidden,
  useResting,
  WellbeingPanel,
} from '@sirius/ui';
import { useMemo, useState } from 'react';
import {
  useAddTask,
  useAgentEvents,
  useAgents,
  useClient,
  useConversation,
  useDropTask,
  useGoals,
  useLearning,
  useOp,
  useProposals,
  useReminders,
  useSetQuiet,
  useSettings,
  useToday,
  useToggleTask,
  useVoiceState,
} from './data/queries.ts';
import { useLive } from './data/useLive.ts';

const OWNER = 'Antonie';
const SNOOZE_MS = 60 * 60 * 1000;
const REST_AFTER_MS = 30_000;
const CHIPS = [
  'Add goal: read twelve books this year',
  'Learn: linear algebra',
  'I feel overwhelmed',
];
const WELCOME = 'Quiet on the agent front. Nothing needs you right now. Ask me for anything small.';

function nextOfKind(reminders: ReminderView[], kind: ReminderView['kind']): ReminderView | null {
  return (
    reminders
      .filter((r) => r.kind === kind && r.enabled && r.next_fire_at !== null)
      .sort((a, b) => (a.next_fire_at ?? 0) - (b.next_fire_at ?? 0))[0] ?? null
  );
}

export function App() {
  const client = useClient();
  const hidden = usePageHidden();
  const resting = useResting(REST_AFTER_MS);
  const live = useLive();

  const today = useToday().data;
  const goals = useGoals().data ?? [];
  const roadmaps = useLearning().data ?? [];
  const reminders = useReminders().data ?? [];
  const proposals = useProposals().data ?? [];
  const agents = useAgents().data;
  const conversation = useConversation().data;
  const agentEvents = useAgentEvents().data ?? [];
  const voice = useVoiceState().data;
  const settings = useSettings().data;

  const addTask = useAddTask();
  const toggleTask = useToggleTask();
  const dropTask = useDropTask();
  const setQuiet = useSetQuiet();
  const renameGoal = useOp('rename_goal', ['list_goals']);
  const deleteGoal = useOp('delete_goal', ['list_goals']);
  const renameRoadmap = useOp('rename_roadmap', ['list_learning']);
  const deleteRoadmap = useOp('delete_roadmap', ['list_learning']);
  const stepToToday = useOp('step_to_today', ['get_today']);
  const setReminderEnabled = useOp('set_reminder_enabled', ['list_reminders']);
  const snoozeReminder = useOp('snooze_reminder', ['list_reminders']);
  const selectAgent = useOp('select_agent', ['get_agents']);
  const newConversation = useOp('new_conversation', ['get_conversation']);
  const confirmProposal = useOp('confirm_proposal', ['list_proposals', 'get_conversation']);
  const rejectProposal = useOp('reject_proposal', ['list_proposals', 'get_conversation']);
  const undo = useOp('undo', ['get_today', 'list_goals', 'list_learning', 'list_reminders']);
  const ackEvent = useOp('ack_agent_event', ['list_agent_events', 'get_agents']);

  const [dismissedToasts, setDismissedToasts] = useState<ReadonlySet<string>>(new Set());
  const [sendError, setSendError] = useState<string | null>(null);
  const [pendingText, setPendingText] = useState<string | null>(null);

  const quiet = today?.quiet_mode ?? false;
  const tasks = today?.tasks;
  const hour = new Date().getHours();

  const { suggestions, openPriorities } = useMemo(() => {
    const open = tasks?.filter((t) => t.status === 'open') ?? [];
    const priorities = open.filter((t) => t.tier === 'priority');
    const current = roadmaps.find((r) => r.status === 'active');
    const step = current ? nextStep(current) : undefined;
    return {
      openPriorities: priorities.length,
      suggestions: buildSuggestions({
        openPriorities: priorities.map((t) => t.title),
        openSmalls: open.filter((t) => t.tier === 'small').map((t) => t.title),
        nextStep: step ? { title: step.title, est_minutes: step.est_minutes } : null,
        quiet,
        hour,
      }),
    };
  }, [roadmaps, tasks, quiet, hour]);

  const voiceState = voice?.state ?? 'idle';
  const avatar: AvatarState =
    voiceState === 'listening'
      ? 'listening'
      : voiceState === 'speaking'
        ? 'speaking'
        : live.thinking || live.streaming !== null || voiceState === 'thinking'
          ? 'thinking'
          : quiet
            ? 'asleep'
            : 'idle';

  // "listening" is reserved for the real microphone, so the idle line never implies it (F33).
  const status = {
    idle: 'nearby',
    listening: 'listening',
    thinking: 'thinking it over',
    speaking: 'speaking',
    asleep: 'asleep until tomorrow',
  }[avatar];

  const messages: ChatLine[] = (conversation?.messages ?? [])
    .filter((m) => m.role !== 'tool')
    .map((m) => ({ id: m.id, mine: m.role === 'user', text: m.text }));
  const lines: ChatLine[] = [
    ...(messages.length === 0 && pendingText === null
      ? [{ id: 'welcome', mine: false, text: WELCOME }]
      : []),
    ...messages,
    ...(pendingText !== null && !messages.some((m) => m.mine && m.text === pendingText)
      ? [{ id: 'pending', mine: true, text: pendingText }]
      : []),
    ...(sendError ? [{ id: 'error', mine: false, text: sendError }] : []),
  ];

  const send = async (text: string) => {
    setSendError(null);
    setPendingText(text);
    try {
      const { turn_id } = await client.call('send_chat', { text });
      live.beginTurn(turn_id);
    } catch (error) {
      live.endTurn();
      setSendError(error instanceof Error ? error.message : 'That did not reach me.');
    }
  };

  const toastEvent = quiet
    ? undefined
    : agentEvents.find((e) => e.kind !== 'turn_complete' && !dismissedToasts.has(e.id));

  const fallbackAgents = (['claude', 'codex'] as AgentId[]).map((id) => ({
    id,
    label: agentCatalog[id].label,
    model: agentCatalog[id].defaultModel,
    models: agentCatalog[id].models,
    status: 'idle' as const,
    reason: null,
  }));

  return (
    <div className={`app ${hidden ? 'paused' : ''} ${resting ? 'resting' : ''}`}>
      {settings?.['ui.leaves'] !== false && <Leaves />}
      <Header
        greeting={today ? greeting(OWNER, hour, openPriorities) : null}
        suggestions={suggestions}
        quiet={quiet}
        onToggleQuiet={() => setQuiet.mutate(!quiet)}
      />
      {quiet && (
        <div className="quiet-line msg">
          Quiet until tomorrow. Reminders are off, and nothing here needs you.
        </div>
      )}
      <main className="columns">
        <div className="col col-1">
          <TodayPanel
            tasks={today?.tasks ?? []}
            restingTomorrow={today?.resting_tomorrow ?? 0}
            dimmed={quiet}
            onToggle={(task) => toggleTask.mutate(task)}
            onAdd={(title) => addTask.mutate(title)}
            onDrop={(task) => dropTask.mutate(task)}
          />
          <GoalsPanel
            goals={goals}
            dimmed={quiet}
            onRename={(id, title) => renameGoal.mutate({ id, title })}
            onDelete={(id) => deleteGoal.mutate({ id })}
          />
        </div>
        <div className="col col-2">
          <LearningPanel
            roadmaps={roadmaps}
            onStepToToday={(id) => stepToToday.mutate({ id })}
            onRename={(id, title) => renameRoadmap.mutate({ id, title })}
            onDelete={(id) => deleteRoadmap.mutate({ id })}
          />
          <PersonalPanel
            reminders={reminders.filter((r) => r.kind !== 'wellbeing')}
            onToggle={(r) => setReminderEnabled.mutate({ id: r.id, enabled: !r.enabled })}
            onSnooze={(r) => snoozeReminder.mutate({ id: r.id, until: Date.now() + SNOOZE_MS })}
          />
        </div>
        <div className="col col-3">
          <SiriusPanel
            avatar={avatar}
            level={voice?.level ?? 0}
            still={resting}
            status={status}
            selected={agents?.selected ?? 'claude'}
            agents={agents?.agents ?? fallbackAgents}
            onSelectAgent={(agent) => selectAgent.mutate({ agent })}
            onSelectModel={(model) =>
              selectAgent.mutate({ agent: agents?.selected ?? 'claude', model })
            }
            messages={lines}
            streaming={live.streaming}
            thinking={live.thinking}
            busy={live.turnId !== null}
            proposals={proposals}
            onConfirm={(p: Proposal) => confirmProposal.mutate({ id: p.id })}
            onReject={(p: Proposal) => rejectProposal.mutate({ id: p.id })}
            undoLabel={
              live.undoable
                ? `${agentCatalog[live.undoable.actor as AgentId].label} changed that.`
                : null
            }
            onUndo={() => {
              if (live.undoable) undo.mutate({ change_id: live.undoable.change_id });
              live.clearUndo();
            }}
            chips={CHIPS}
            onSend={send}
            onCancel={() => {
              if (live.turnId) void client.call('cancel_chat', { turn_id: live.turnId });
            }}
            onNewConversation={() => {
              setPendingText(null);
              setSendError(null);
              newConversation.mutate({});
            }}
            voice={{
              micOpen: voice?.mic_open ?? false,
              transcript: voice?.transcript ?? null,
              onMic: () => {
                // Wired to the voice service in M6.
              },
            }}
          />
          <WellbeingPanel
            nudge={nextOfKind(reminders, 'wellbeing')}
            onSnoozeNudge={(r) =>
              snoozeReminder.mutate({ id: r.id, until: Date.now() + SNOOZE_MS })
            }
            startSignal={live.breathingSignal}
          />
        </div>
      </main>
      {toastEvent && (
        <AgentToast
          text={describeAgentEvent(toastEvent)}
          onGotIt={() => ackEvent.mutate({ id: toastEvent.id })}
          onLater={() => setDismissedToasts((s) => new Set(s).add(toastEvent.id))}
        />
      )}
    </div>
  );
}
