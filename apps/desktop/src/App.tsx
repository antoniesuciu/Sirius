import {
  type AgentId,
  agentCatalog,
  buildSuggestions,
  describeAgentEvent,
  greeting,
  logicalDate,
  type Proposal,
  type ReminderView,
  type SiriusEvent,
} from '@sirius/contracts';
import {
  AgentToast,
  type AvatarState,
  type ChatLine,
  GoalsPanel,
  Header,
  LearningPanel,
  Leaves,
  ListPanel,
  nextStep,
  type PendingFile,
  PersonalPanel,
  type PhoneTab,
  receiptForIntent,
  receiptsFor,
  SchedulePanel,
  SiriusPanel,
  TabBar,
  TodayPanel,
  tabForEntity,
  usePageHidden,
  useResting,
  WellbeingPanel,
  WindowControls,
} from '@sirius/ui';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ConnectionLine } from './ConnectionLine.tsx';
import { browserVoiceSupported, usePhoneVoice } from './data/browserVoice.ts';
import {
  useAddTask,
  useAddToList,
  useAgentEvents,
  useAgents,
  useClient,
  useConversation,
  useDropTask,
  useGoals,
  useLearning,
  useList,
  useOp,
  useProposals,
  useReminders,
  useSchedule,
  useSetQuiet,
  useSettings,
  useTickListItem,
  useToday,
  useToggleTask,
  useVoiceState,
} from './data/queries.ts';
import { useLive } from './data/useLive.ts';

const OWNER = 'Antonie';
const SNOOZE_MS = 60 * 60 * 1000;
const REST_AFTER_MS = 30_000;
const WELCOME = 'Ask me anything, or tell me what to add.';
/** Spoken commands shown on the phone, which are not part of the thread. */
const HEARD_KEPT = 6;
/** Below this width a phone gets tabs; a laptop browser in development keeps the columns. */
const PHONE_QUERY = '(max-width: 900px)';

function useNarrow(enabled: boolean): boolean {
  const query = typeof window.matchMedia === 'function' ? window.matchMedia(PHONE_QUERY) : null;
  const [narrow, setNarrow] = useState(() => enabled && (query?.matches ?? false));
  useEffect(() => {
    if (!enabled || !query) return;
    const update = () => setNarrow(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, [enabled, query]);
  return narrow;
}

/** fetch rejects with a TypeError when nothing answered, which WebKit words as "Load failed". */
function failureText(error: unknown): string {
  if (error instanceof Error && !(error instanceof TypeError)) return error.message;
  return "I can't reach my core just now. It should be back in a moment. If not, try sirius doctor.";
}

function nextOfKind(reminders: ReminderView[], kind: ReminderView['kind']): ReminderView | null {
  return (
    reminders
      .filter((r) => r.kind === kind && r.enabled && r.next_fire_at !== null)
      .sort((a, b) => (a.next_fire_at ?? 0) - (b.next_fire_at ?? 0))[0] ?? null
  );
}

/** `phone` is a browser: it keeps an offline copy and says when the laptop is away. */
export function App({ phone = false }: { phone?: boolean }) {
  const client = useClient();
  const hidden = usePageHidden();
  const resting = useResting(REST_AFTER_MS);
  const tabbed = useNarrow(phone);
  const [tab, setTab] = useState<PhoneTab>('sirius');
  const [fresh, setFresh] = useState<ReadonlySet<PhoneTab>>(new Set());
  const [heard, setHeard] = useState<Array<{ at: number; line: ChatLine }>>([]);
  const shownTab = useRef(tab);
  shownTab.current = tab;

  const [sendError, setSendError] = useState<string | null>(null);
  const phoneVoice = usePhoneVoice(client, {
    onError: setSendError,
    onHeard: ({ transcript, reply, intent }) => {
      const receipt = receiptForIntent(intent);
      const at = Date.now();
      setHeard((now) =>
        [
          ...now,
          { at, line: { id: `heard-${at}`, mine: true, text: transcript } },
          ...(reply
            ? [
                {
                  at,
                  line: {
                    id: `said-${at}`,
                    mine: false,
                    text: reply,
                    ...(receipt ? { receipts: [receipt] } : {}),
                  },
                },
              ]
            : []),
        ].slice(-HEARD_KEPT),
      );
    },
  });
  const phoneMic = phone && browserVoiceSupported();

  const openTab = (next: PhoneTab) => {
    setTab(next);
    setFresh((now) => {
      if (!now.has(next)) return now;
      const rest = new Set(now);
      rest.delete(next);
      return rest;
    });
  };

  const listen = (event: SiriusEvent) => {
    phoneVoice.onEvent(event);
    if (!tabbed || event.type !== 'change') return;
    const where = tabForEntity(event.entity);
    if (where && where !== shownTab.current) {
      setFresh((now) => (now.has(where) ? now : new Set(now).add(where)));
    }
  };
  const live = useLive(listen);

  // "Start breathing" said to the phone should show the breathing, which lives under Today.
  const breathing = live.breathingSignal;
  useEffect(() => {
    if (tabbed && breathing > 0) setTab('today');
  }, [tabbed, breathing]);

  const today = useToday().data;
  const goals = useGoals().data ?? [];
  const roadmaps = useLearning().data ?? [];
  const reminders = useReminders().data ?? [];
  const listItems = useList().data;
  const schedule = useSchedule().data ?? [];
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
  const addGoal = useOp('add_goal', ['list_goals']);
  const addScheduleEvent = useOp('add_schedule_event', ['list_schedule', 'get_today']);
  const updateScheduleEvent = useOp('update_schedule_event', ['list_schedule', 'get_today']);
  const deleteScheduleEvent = useOp('delete_schedule_event', ['list_schedule', 'get_today']);
  const addToList = useAddToList();
  const tickListItem = useTickListItem();
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
  const [files, setFiles] = useState<PendingFile[]>([]);
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

  const voiceState = phoneVoice.recording
    ? 'listening'
    : phoneVoice.speaking
      ? 'speaking'
      : phoneVoice.sending
        ? 'thinking'
        : (voice?.state ?? 'idle');
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
    idle: 'ready',
    listening: 'listening',
    thinking: 'thinking',
    speaking: 'speaking',
    asleep: 'quiet until tomorrow',
  }[avatar];

  const thread = (conversation?.messages ?? [])
    .filter((m) => m.role !== 'tool')
    .map((m) => {
      const files = (m.meta?.attachments as Array<{ name: string }> | undefined) ?? [];
      const receipts = receiptsFor((m.meta?.tools as string[] | undefined) ?? []);
      return {
        id: m.id,
        mine: m.role === 'user',
        text: m.text,
        ...(files.length > 0 ? { attachments: files.map((f) => f.name) } : {}),
        ...(receipts.length > 0 ? { receipts } : {}),
      };
    });
  // Spoken commands slot in by time, so a later typed message still comes after them.
  const stamps = new Map((conversation?.messages ?? []).map((m) => [m.id, m.created_at]));
  const messages: ChatLine[] = [
    ...thread.map((line) => ({ at: stamps.get(line.id) ?? 0, line })),
    ...heard,
  ]
    .sort((a, b) => a.at - b.at)
    .map((entry) => entry.line);
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

  const showFailure = { onError: (error: unknown) => setSendError(failureText(error)) };

  const send = async (text: string) => {
    setSendError(null);
    setPendingText(text);
    const attachment_ids = files.map((f) => f.id);
    try {
      // The turn's own `start` event marks it active. Marking it here too would race a fast
      // failure, whose events can arrive before this response and leave the panel stuck.
      await client.call('send_chat', {
        text,
        ...(attachment_ids.length ? { attachment_ids } : {}),
      });
      setFiles([]);
    } catch (error) {
      setSendError(failureText(error));
    }
  };

  const attach = (file: File) => {
    setSendError(null);
    client
      .attach(file, file.name)
      .then((kept) => {
        const size = kept.pages ? `${kept.pages} page${kept.pages === 1 ? '' : 's'}` : '';
        const detail = [size, kept.truncated ? 'cut to fit' : ''].filter(Boolean).join(', ');
        setFiles((now) => [...now, { id: kept.id, name: kept.name, detail }]);
      })
      .catch((error) => setSendError(failureText(error)));
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

  const onMic = () => {
    setSendError(null);
    if (phoneMic) {
      if (tabbed) openTab('sirius');
      return phoneVoice.toggle();
    }
    client.call('voice_ptt', {}).catch((error) => setSendError(failureText(error)));
  };

  const siriusPanel = (
    <SiriusPanel
      avatar={avatar}
      level={voice?.level ?? 0}
      still={resting}
      status={status}
      selected={agents?.selected ?? 'claude'}
      agents={agents?.agents ?? fallbackAgents}
      onSelectAgent={(agent) => selectAgent.mutate({ agent }, showFailure)}
      onSelectModel={(model) =>
        selectAgent.mutate({ agent: agents?.selected ?? 'claude', model }, showFailure)
      }
      messages={lines}
      streaming={live.streaming}
      thinking={live.thinking}
      busy={live.turnId !== null}
      proposals={proposals}
      onConfirm={(p: Proposal) => confirmProposal.mutate({ id: p.id })}
      onReject={(p: Proposal) => rejectProposal.mutate({ id: p.id })}
      undoLabel={
        live.undoable ? `${agentCatalog[live.undoable.actor as AgentId].label} changed that.` : null
      }
      onUndo={() => {
        if (live.undoable) undo.mutate({ change_id: live.undoable.change_id });
        live.clearUndo();
      }}
      onSend={send}
      files={files}
      onAttach={attach}
      onRemoveFile={(id) => setFiles((now) => now.filter((f) => f.id !== id))}
      onCancel={() => {
        if (live.turnId) void client.call('cancel_chat', { turn_id: live.turnId });
      }}
      onNewConversation={() => {
        setPendingText(null);
        setSendError(null);
        setHeard([]);
        newConversation.mutate({});
      }}
      voice={{
        micOpen: (voice?.mic_open ?? false) || phoneVoice.recording,
        transcript: voice?.transcript ?? null,
        onMic,
        onStop: () => {
          phoneVoice.stopSpeaking();
          void client.call('voice_stop', {}).catch(() => {});
        },
      }}
      {...(tabbed ? { onOpenTab: openTab, compact: true } : {})}
    />
  );
  const wellbeingPanel = (
    <WellbeingPanel
      nudge={nextOfKind(reminders, 'wellbeing')}
      onSnoozeNudge={(r) => snoozeReminder.mutate({ id: r.id, until: Date.now() + SNOOZE_MS })}
      startSignal={live.breathingSignal}
    />
  );
  const todayPanel = (
    <TodayPanel
      tasks={today?.tasks ?? []}
      restingTomorrow={today?.resting_tomorrow ?? 0}
      dimmed={quiet}
      onToggle={(task) => toggleTask.mutate(task)}
      onAdd={(title) => addTask.mutate(title)}
      onDrop={(task) => dropTask.mutate(task)}
    />
  );
  const schedulePanel = (
    <SchedulePanel
      events={schedule}
      today={
        today?.date ?? logicalDate(Date.now(), Intl.DateTimeFormat().resolvedOptions().timeZone)
      }
      onAdd={(event) => addScheduleEvent.mutate(event)}
      onRename={(id, title) => updateScheduleEvent.mutate({ id, title })}
      onDelete={(id) => deleteScheduleEvent.mutate({ id })}
    />
  );
  const goalsPanel = (
    <GoalsPanel
      goals={goals}
      dimmed={quiet}
      onRename={(id, title) => renameGoal.mutate({ id, title })}
      onDelete={(id) => deleteGoal.mutate({ id })}
      onAdd={(title) => addGoal.mutate({ title })}
    />
  );
  const learningPanel = (
    <LearningPanel
      roadmaps={roadmaps}
      onStepToToday={(id) => stepToToday.mutate({ id })}
      onRename={(id, title) => renameRoadmap.mutate({ id, title })}
      onDelete={(id) => deleteRoadmap.mutate({ id })}
    />
  );
  const personalPanel = (
    <PersonalPanel
      reminders={reminders.filter((r) => r.kind !== 'wellbeing')}
      onToggle={(r) => setReminderEnabled.mutate({ id: r.id, enabled: !r.enabled })}
      onSnooze={(r) => snoozeReminder.mutate({ id: r.id, until: Date.now() + SNOOZE_MS })}
    />
  );
  const listPanel = (
    <ListPanel
      items={listItems ?? []}
      onAdd={(text) => addToList.mutate(text)}
      onTick={(item) => tickListItem.mutate(item)}
    />
  );

  return (
    <div
      className={`app ${tabbed ? 'app-tabbed' : ''} ${hidden ? 'paused' : ''} ${resting ? 'resting' : ''}`}
    >
      {'__TAURI_INTERNALS__' in window && (
        <WindowControls
          onMinimize={() => void getCurrentWindow().minimize()}
          onToggleMaximize={() => void getCurrentWindow().toggleMaximize()}
          onClose={() => void getCurrentWindow().close()}
        />
      )}
      {settings?.['ui.leaves'] !== false && <Leaves />}
      <Header
        greeting={today ? greeting(OWNER, hour, openPriorities) : null}
        suggestions={suggestions}
        quiet={quiet}
        onToggleQuiet={() => setQuiet.mutate(!quiet)}
      />
      {phone && <ConnectionLine />}
      {quiet && <div className="quiet-line msg">Quiet mode until tomorrow. Reminders are off.</div>}
      {tabbed ? (
        <>
          {/* Every section stays mounted, so a draft or a breathing round survives a switch. */}
          {/* On Sirius only the chat scrolls; the other sections scroll as a whole. */}
          <main className={`phone-body ${tab === 'sirius' ? 'phone-body-still' : ''}`}>
            <div className="phone-section phone-sirius" hidden={tab !== 'sirius'}>
              {siriusPanel}
            </div>
            <div className="phone-section" hidden={tab !== 'today'}>
              {todayPanel}
              {schedulePanel}
              {wellbeingPanel}
            </div>
            <div className="phone-section" hidden={tab !== 'plan'}>
              {goalsPanel}
              {learningPanel}
            </div>
            <div className="phone-section" hidden={tab !== 'list'}>
              {listPanel}
              {personalPanel}
            </div>
          </main>
          <TabBar
            active={tab}
            fresh={fresh}
            onSelect={openTab}
            micOpen={phoneVoice.recording}
            micBusy={phoneVoice.sending || phoneVoice.speaking}
            onMic={onMic}
          />
        </>
      ) : (
        <main className="columns">
          {/* Sirius first, so the first thing on the screen is someone to talk to. */}
          <div className="col col-3">
            {siriusPanel}
            {wellbeingPanel}
          </div>
          <div className="col col-1">
            {todayPanel}
            {schedulePanel}
            {goalsPanel}
          </div>
          <div className="col col-2">
            {learningPanel}
            {personalPanel}
            {listPanel}
          </div>
        </main>
      )}
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
