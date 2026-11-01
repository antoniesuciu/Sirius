/**
 * Agents and models offered by the Sirius switch and model select.
 *
 * To offer another model, add a line here. Ids come from `docs/verified.md`.
 */
import type { AgentId } from './schemas.ts';

export interface ModelOption {
  id: string;
  label: string;
}

export interface AgentCatalogEntry {
  id: AgentId;
  label: string;
  defaultModel: string;
  models: ModelOption[];
}

export const agentCatalog: Record<AgentId, AgentCatalogEntry> = {
  claude: {
    id: 'claude',
    label: 'Claude',
    defaultModel: 'claude-haiku-5-5',
    models: [
      { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5' },
      { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' },
      { id: 'claude-opus-5-5', label: 'Claude Opus 5.5' },
    ],
  },
  codex: {
    id: 'codex',
    label: 'Codex',
    // The spec's "6.1 Sol Light" is this model at low reasoning effort (docs/verified.md).
    defaultModel: 'gpt-6.1-sol',
    models: [
      { id: 'gpt-6.1-sol', label: 'Codex 6.1 Sol Light' },
      { id: 'gpt-6.1-terra', label: 'Codex 6.1 Terra' },
    ],
  },
};

export function modelLabel(agent: AgentId, model: string): string {
  return agentCatalog[agent].models.find((m) => m.id === model)?.label ?? model;
}
