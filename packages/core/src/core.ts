/** The composition root: everything the service is, minus the process around it. */

import { type AgentId, logicalDate } from '@sirius/contracts';
import type { AgentAdapter } from './agents/types.ts';
import { Backups } from './backups.ts';
import { EventBus } from './bus.ts';
import { migrate } from './db/migrate.ts';
import { Dispatcher, type SystemHandlers } from './dispatcher.ts';
import { DomainError } from './errors.ts';
import type { Notifier } from './notifier.ts';
import { RateLimitedNotifier } from './notifier.ts';
import type { OpHooks } from './ops/context.ts';
import { openSqlite, type SqliteHandle } from './runtime/sqlite.ts';
import { Scheduler } from './scheduler.ts';
import { Agents } from './services/agents.ts';
import { Attention } from './services/attention.ts';
import { Chat } from './services/chat.ts';
import { Decisions } from './services/decisions.ts';
import { Settings } from './services/settings.ts';
import { VoiceState } from './services/voice.ts';
import { Store } from './store.ts';
import { VoiceRouter } from './voice/router.ts';

export interface CoreOptions {
  dbPath: string;
  backupDir?: string;
  timeZone: string;
  notifier: Notifier;
  adapters: Record<AgentId, AgentAdapter>;
  clock?: () => number;
}

export interface Core {
  sqlite: SqliteHandle;
  bus: EventBus;
  store: Store;
  dispatcher: Dispatcher;
  scheduler: Scheduler;
  attention: Attention;
  chat: Chat;
  voice: VoiceState;
  close(): void;
}

export function createCore(options: CoreOptions): Core {
  const clock = options.clock ?? Date.now;
  const { timeZone } = options;
  const sqlite = openSqlite(options.dbPath);
  migrate(sqlite);

  const bus = new EventBus();
  const store = new Store(sqlite.db, bus, clock);
  const notifier = new RateLimitedNotifier(options.notifier, clock);
  const settings = new Settings(store);
  const attention = new Attention(store, bus, notifier, timeZone);
  const hooks: OpHooks = { quietEnded: (since) => attention.releaseSince(since) };
  // The router and chat need each other, and the dispatcher needs them both, so the router
  // resolves its collaborators late.
  let dispatcher: Dispatcher;
  let chat: Chat;
  const router = new VoiceRouter(
    store,
    bus,
    () => chat,
    () => dispatcher,
    timeZone,
  );
  chat = new Chat(store, settings, bus, options.adapters, router);
  const agents = new Agents(store, settings, chat, attention, timeZone);
  const voice = new VoiceState(bus);
  const decisions = new Decisions(store, timeZone, hooks);

  const backups = options.backupDir ? new Backups(sqlite, options.backupDir) : null;

  const system: SystemHandlers = {
    confirm_proposal: ({ id }, caller) => decisions.confirm(id, caller.via),
    reject_proposal: ({ id }) => decisions.reject(id),
    undo: ({ change_id }) => decisions.undo(change_id),
    get_agents: () => agents.view(),
    select_agent: ({ agent, model }) => agents.select(agent, model),
    get_conversation: () => chat.view(),
    new_conversation: () => chat.reset(),
    send_chat: (input) => chat.send(input),
    cancel_chat: ({ turn_id }) => {
      chat.cancel(turn_id);
      return { ok: true };
    },
    post_agent_event: (input) => attention.post(input),
    list_agent_events: () => attention.pending(),
    ack_agent_event: ({ id }) => attention.ack(id),
    voice_utterance: (input) => router.utterance(input),
    set_voice_state: (input) => {
      voice.set(input);
      return { ok: true };
    },
    get_voice_state: () => voice.view(),
    voice_ptt: () => {
      voice.command('ptt');
      return { ok: true };
    },
    voice_stop: () => {
      voice.command('stop');
      return { ok: true };
    },
    create_backup: () => {
      if (!backups) throw new DomainError(503, 'no_backups', 'Backups are not configured.');
      return { path: backups.snapshot(logicalDate(store.now(), timeZone)) };
    },
    get_settings: () => settings.all(),
    set_setting: ({ key, value }) => {
      settings.set(key, value);
      return { ok: true };
    },
  };

  dispatcher = new Dispatcher(store, timeZone, system, hooks);
  const scheduler = new Scheduler(store, timeZone, notifier, attention, hooks, backups);

  return {
    sqlite,
    bus,
    store,
    dispatcher,
    scheduler,
    attention,
    chat,
    voice,
    close() {
      scheduler.stop();
      sqlite.close();
    },
  };
}
