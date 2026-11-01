import type { SiriusEvent } from '@sirius/contracts';

export type Listener = (event: SiriusEvent) => void;

/** In-process pub/sub behind `GET /v1/events`. A failing listener cannot affect the others. */
export class EventBus {
  private readonly listeners = new Set<Listener>();

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  publish(event: SiriusEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        console.error('SSE listener failed', error);
      }
    }
  }
}
