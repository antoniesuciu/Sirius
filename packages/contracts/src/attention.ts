import { agentCatalog } from './models.ts';
import type { AgentEvent } from './schemas.ts';

/** The calm sentence for an agent event, shared by the toast and the native notification. */
export function describeAgentEvent(
  event: Pick<AgentEvent, 'source' | 'kind' | 'project' | 'message'>,
): string {
  const name = agentCatalog[event.source].label;
  const where = event.project ? ` in ${event.project}` : '';
  switch (event.kind) {
    case 'needs_input': {
      const what = /permission|approv/i.test(event.message ?? '') ? 'an approval' : 'you';
      return `${name} is waiting for ${what}${where}. No rush, it will keep.`;
    }
    case 'turn_complete':
      return `${name} finished${where}.`;
    case 'error':
      return `${name} ran into a problem${where}. It can wait until you look.`;
  }
}
