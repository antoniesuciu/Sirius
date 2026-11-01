import {
  type AgentId,
  agentCatalog,
  type ConversationView,
  type OpInput,
  type OpOutput,
} from '@sirius/contracts';
import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import { conversations, messages } from '../db/schema.ts';
import { DomainError } from '../errors.ts';
import type { Store } from '../store.ts';
import type { Settings } from './settings.ts';

export const SELECTED_AGENT = 'agent.selected';
export const MODELS = 'agent.models';

export class Chat {
  constructor(
    private readonly store: Store,
    private readonly settings: Settings,
  ) {}

  selected(): AgentId {
    return this.settings.get<AgentId>(SELECTED_AGENT, 'claude');
  }

  modelFor(agent: AgentId): string {
    const chosen = this.settings.get<Partial<Record<AgentId, string>>>(MODELS, {});
    return chosen[agent] ?? agentCatalog[agent].defaultModel;
  }

  private current() {
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
    return { conversation, messages: rows, active_turn_id: null };
  }

  reset(): ConversationView {
    const agent = this.selected();
    this.store.write('user', (tx) =>
      tx.insert('conversations', { agent, model: this.modelFor(agent) }),
    );
    return this.view();
  }

  send(_input: OpInput<'send_chat'>): OpOutput<'send_chat'> {
    throw new DomainError(503, 'chat_unavailable', 'Sirius chat is not set up yet.');
  }

  cancel(_turnId: string): void {}

  activeAgent(): AgentId | null {
    return null;
  }

  availability(_agent: AgentId): { ok: boolean; reason?: string } {
    return { ok: true };
  }
}
