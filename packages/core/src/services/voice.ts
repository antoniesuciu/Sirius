import type { OpInput, OpOutput, VoiceStateView } from '@sirius/contracts';
import type { EventBus } from '../bus.ts';
import { DomainError } from '../errors.ts';

const IDLE: VoiceStateView = { state: 'idle', transcript: null, mic_open: false, level: null };

/** Ephemeral by design: what the voice service is doing right now is never persisted. */
export class VoiceState {
  private current: VoiceStateView = IDLE;

  constructor(private readonly bus: EventBus) {}

  view(): VoiceStateView {
    return this.current;
  }

  set(state: VoiceStateView): void {
    this.current = state;
    this.bus.publish({ type: 'voice', state });
  }

  utterance(_input: OpInput<'voice_utterance'>): OpOutput<'voice_utterance'> {
    throw new DomainError(503, 'voice_unavailable', 'Voice is not set up yet.');
  }
}
