import {
  type AgentId,
  type AgentInfo,
  type AgentStatusValue,
  type AgentsView,
  agentCatalog,
  logicalDate,
} from '@sirius/contracts';
import type { Store } from '../store.ts';
import type { Attention } from './attention.ts';
import { type Chat, MODELS, SELECTED_AGENT } from './chat.ts';
import type { Settings } from './settings.ts';

export class Agents {
  constructor(
    private readonly store: Store,
    private readonly settings: Settings,
    private readonly chat: Chat,
    private readonly attention: Attention,
    private readonly timeZone: string,
  ) {}

  private isQuiet(): boolean {
    const today = logicalDate(this.store.now(), this.timeZone);
    return this.store.write('system', (tx) => tx.peek('day_state', today)?.quiet_mode ?? false);
  }

  private info(id: AgentId, quiet: boolean, waiting: Set<AgentId>): AgentInfo {
    const entry = agentCatalog[id];
    const availability = this.chat.availability(id);
    let status: AgentStatusValue = 'idle';
    if (!availability.ok) status = 'unavailable';
    else if (this.chat.activeAgent() === id) status = 'working';
    else if (quiet) status = 'resting';
    else if (waiting.has(id)) status = 'waiting';
    // A session in any terminal, reported by its hooks (sirius notify --activity).
    else if (this.attention.isWorking(id)) status = 'working';
    return {
      id,
      label: entry.label,
      model: this.chat.modelFor(id),
      models: entry.models,
      status,
      reason: availability.reason ?? null,
    };
  }

  view(): AgentsView {
    const waiting = new Set(
      this.attention
        .pending()
        .filter((e) => e.kind === 'needs_input')
        .map((e) => e.source),
    );
    const quiet = this.isQuiet();
    return {
      selected: this.chat.selected(),
      agents: (['claude', 'codex'] as const).map((id) => this.info(id, quiet, waiting)),
    };
  }

  select(agent: AgentId, model?: string): AgentsView {
    this.settings.set(SELECTED_AGENT, agent);
    if (model) {
      const models = this.settings.get<Record<string, string>>(MODELS, {});
      this.settings.set(MODELS, { ...models, [agent]: model });
    }
    return this.view();
  }
}
