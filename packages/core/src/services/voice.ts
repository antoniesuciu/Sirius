import type { VoiceStateView } from '@sirius/contracts';
import type { EventBus } from '../bus.ts';
import { DomainError } from '../errors.ts';

const IDLE: VoiceStateView = { state: 'idle', transcript: null, mic_open: false, level: null };

/** Ephemeral by design: what the voice service is doing right now is never persisted. */
export class VoiceState {
  private current: VoiceStateView = IDLE;
  private connections = 0;

  constructor(private readonly bus: EventBus) {}

  view(): VoiceStateView {
    return this.current;
  }

  set(state: VoiceStateView): void {
    this.current = state;
    this.bus.publish({ type: 'voice', state });
  }

  /**
   * The voice service holds an SSE connection. If it dies mid-sentence nobody else will say
   * the mic closed, so losing the connection resets the state the indicator is built on.
   */
  attach(): () => void {
    this.connections += 1;
    return () => {
      this.connections -= 1;
      if (this.connections === 0) this.set(IDLE);
    };
  }

  /** Relays a command, or says plainly that nothing is there to hear it. */
  command(command: 'ptt' | 'stop'): void {
    if (this.connections === 0) {
      throw new DomainError(503, 'voice_unavailable', "Voice isn't running right now.");
    }
    this.bus.publish({ type: 'voice_command', command });
  }
}
