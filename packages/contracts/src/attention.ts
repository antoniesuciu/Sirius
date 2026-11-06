import { agentCatalog } from './models.ts';
import type { AgentEvent } from './schemas.ts';

/** The sentence for an agent event, shared by the toast and the native notification. */
export function describeAgentEvent(
  event: Pick<AgentEvent, 'source' | 'kind' | 'project' | 'message'>,
): string {
  // These come from sessions in a terminal or editor, not from Sirius's own chat. A folder
  // called "sirius" otherwise reads as if the dashboard itself were waiting.
  const name = event.source === 'claude' ? 'Claude Code' : agentCatalog[event.source].label;
  const where = event.project ? ` in the ${event.project} folder` : '';
  switch (event.kind) {
    case 'needs_input': {
      if (/has a question for you/i.test(event.message ?? '')) {
        return `${name} has a question for you${where}.`;
      }
      const what = /permission|approv/i.test(event.message ?? '') ? 'an approval' : 'you';
      return `${name} is waiting for ${what}${where}.`;
    }
    case 'turn_complete':
      return `${name} finished${where}.`;
    case 'error':
      return `${name} ran into a problem${where}.`;
  }
}
