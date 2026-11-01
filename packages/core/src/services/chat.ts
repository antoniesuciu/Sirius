/**
 * Sirius chat (F15–F22): owns conversations and runs one agent turn at a time. A turn
 * streams over the event bus and persists when it ends, so a closed window loses nothing.
 */
import {
  type AgentId,
  agentCatalog,
  type ConversationView,
  type OpInput,
  type OpOutput,
} from '@sirius/contracts';
import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import type { AgentAdapter } from '../agents/types.ts';
import { calmError } from '../agents/types.ts';
import type { EventBus } from '../bus.ts';
import { conversations, messages } from '../db/schema.ts';
import { conflict } from '../errors.ts';
import type { Row, Store } from '../store.ts';
import { uuidv7 } from '../uuid.ts';
import type { Settings } from './settings.ts';

export const SELECTED_AGENT = 'agent.selected';
export const MODELS = 'agent.models';

const TURN_TIMEOUT_MS = 60_000;
const AVAILABILITY_TTL_MS = 5 * 60 * 1000;
const SPOKEN_SUFFIX =
  '\n\n(This came through voice. Answer in one or two short sentences that read well aloud.)';

interface ActiveTurn {
  id: string;
  agent: AgentId;
  controller: AbortController;
}

export interface TurnObserver {
  text(turnId: string, delta: string): void;
  end(turnId: string): void;
}

export class Chat {
  private active: ActiveTurn | null = null;
  private availabilityCache = new Map<AgentId, { ok: boolean; reason?: string }>();
  private lastProbe = 0;

  constructor(
    private readonly store: Store,
    private readonly settings: Settings,
    private readonly bus: EventBus,
    private readonly adapters: Record<AgentId, AgentAdapter>,
    private readonly observer?: TurnObserver,
  ) {}

  selected(): AgentId {
    return this.settings.get<AgentId>(SELECTED_AGENT, 'claude');
  }

  modelFor(agent: AgentId): string {
    const chosen = this.settings.get<Partial<Record<AgentId, string>>>(MODELS, {});
    return chosen[agent] ?? agentCatalog[agent].defaultModel;
  }

  activeAgent(): AgentId | null {
    return this.active?.agent ?? null;
  }

  /** Answers from cache so `get_agents` stays synchronous, and refreshes behind the scenes. */
  availability(agent: AgentId): { ok: boolean; reason?: string } {
    if (Date.now() - this.lastProbe > AVAILABILITY_TTL_MS) {
      this.lastProbe = Date.now();
      void this.refreshAvailability();
    }
    return this.availabilityCache.get(agent) ?? { ok: true };
  }

  async refreshAvailability(): Promise<void> {
    await Promise.all(
      Object.values(this.adapters).map(async (adapter) => {
        this.availabilityCache.set(adapter.id, await adapter.available());
      }),
    );
  }

  private current(): Row<'conversations'> | undefined {
    return this.store.db
      .select()
      .from(conversations)
      .where(isNull(conversations.deleted_at))
      .orderBy(desc(conversations.id))
      .get();
  }

  view(): ConversationView {
    const conversation = this.current() ?? null;
    const rows = conversation
      ? this.store.db
          .select()
          .from(messages)
          .where(and(eq(messages.conversation_id, conversation.id), isNull(messages.deleted_at)))
          .orderBy(asc(messages.id))
          .all()
      : [];
    return { conversation, messages: rows, active_turn_id: this.active?.id ?? null };
  }

  reset(): ConversationView {
    const agent = this.selected();
    this.store.write('user', (tx) =>
      tx.insert('conversations', { agent, model: this.modelFor(agent) }),
    );
    return this.view();
  }

  /** CLI sessions are not portable, so changing agent or model starts a new conversation. */
  private conversationFor(agent: AgentId, model: string): Row<'conversations'> {
    const current = this.current();
    if (current?.agent === agent && current.model === model) return current;
    return this.store.write('user', (tx) => tx.insert('conversations', { agent, model }));
  }

  send({ text, via }: OpInput<'send_chat'>): OpOutput<'send_chat'> {
    if (this.active) throw conflict('Sirius is still answering.');
    const agent = this.selected();
    const conversation = this.conversationFor(agent, this.modelFor(agent));
    this.store.write('user', (tx) => {
      tx.insert('messages', { conversation_id: conversation.id, role: 'user', text });
      if (!conversation.title)
        tx.update('conversations', conversation.id, { title: text.slice(0, 80) });
    });

    const turn: ActiveTurn = { id: uuidv7(), agent, controller: new AbortController() };
    this.active = turn;
    void this.runTurn(turn, conversation, via === 'voice' ? `${text}${SPOKEN_SUFFIX}` : text);
    return { turn_id: turn.id, conversation_id: conversation.id };
  }

  cancel(turnId: string): void {
    if (this.active?.id === turnId) this.active.controller.abort();
  }

  /** Never throws: any failure becomes a calm sentence in the chat (F22). */
  private async runTurn(
    turn: ActiveTurn,
    conversation: Row<'conversations'>,
    prompt: string,
  ): Promise<void> {
    const { id: turnId, agent, controller } = turn;
    this.bus.publish({ type: 'chat', kind: 'start', turn_id: turnId, agent });

    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(TURN_TIMEOUT_MS)]);
    let reply = '';
    let failure: string | null = null;
    let sessionId: string | undefined;
    const tools: string[] = [];

    try {
      const stream = this.adapters[agent].run({
        prompt,
        model: conversation.model,
        signal,
        ...(conversation.cli_session_id ? { sessionId: conversation.cli_session_id } : {}),
      });
      for await (const event of stream) {
        if (event.type === 'text') {
          reply += event.delta;
          this.bus.publish({ type: 'chat', kind: 'text', turn_id: turnId, delta: event.delta });
          this.observer?.text(turnId, event.delta);
        } else if (event.type === 'tool') {
          tools.push(event.name);
          this.bus.publish({ type: 'chat', kind: 'tool', turn_id: turnId, name: event.name });
        } else if (event.type === 'done') {
          sessionId = event.sessionId;
        } else {
          failure = event.message;
        }
      }
    } catch (error) {
      if (!signal.aborted) failure = error instanceof Error ? error.message : String(error);
    }
    if (signal.aborted && !controller.signal.aborted) failure = 'timed out';
    // The user gets a calm sentence; the journal gets the real reason.
    if (failure !== null) console.warn(`${agent} turn failed: ${failure}`);
    const calm = failure === null ? null : failureSentence(agent, failure);

    this.active = null;
    this.store.write('system', (tx) => {
      if (sessionId) tx.update('conversations', conversation.id, { cli_session_id: sessionId });
      const text = calm ?? reply.trim();
      if (text) {
        tx.insert('messages', {
          conversation_id: conversation.id,
          role: 'assistant',
          text,
          meta: { tools, ...(calm ? { error: true } : {}) },
        });
      }
    });

    if (calm) {
      this.bus.publish({ type: 'chat', kind: 'error', turn_id: turnId, message: calm });
      this.observer?.text(turnId, calm);
    } else {
      this.bus.publish({ type: 'chat', kind: 'done', turn_id: turnId });
    }
    this.observer?.end(turnId);
  }
}

function failureSentence(agent: AgentId, failure: string): string {
  if (failure === 'timed out') {
    return 'That took too long, so I stopped. Nothing else changed. You could try again.';
  }
  return calmError(agent, failure);
}
