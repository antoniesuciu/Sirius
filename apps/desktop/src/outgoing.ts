import type { ChatLine, PendingFile } from '@sirius/ui';

/**
 * A typed message on its way to the core. `at` names the send, so a late answer to an older one
 * is ignored. `after` is the id of my newest stored line when it was sent: once a newer one is
 * stored, that is this message, and its pending copy goes. Matching by text would also hide a
 * resend of the same words.
 */
export type Outgoing =
  | { kind: 'idle' }
  /** `sending`: the request is out, Send waits. `sent`: accepted, shown until stored. */
  | { kind: 'sending' | 'sent'; text: string; fileIds: string[]; at: number; after: string | null }
  | { kind: 'failed'; text: string; error: string; at: number; after: string | null };

export type OutgoingEvent =
  | { kind: 'send'; text: string; fileIds: string[]; at: number; after: string | null }
  | { kind: 'accepted'; at: number }
  | { kind: 'refused'; at: number; error: string }
  | { kind: 'reset' };

export const IDLE: Outgoing = { kind: 'idle' };

export function outgoingReducer(o: Outgoing, event: OutgoingEvent): Outgoing {
  switch (event.kind) {
    case 'send': {
      if (o.kind === 'sending') return o;
      const { text, fileIds, at, after } = event;
      return { kind: 'sending', text, fileIds, at, after };
    }
    case 'accepted':
      return o.kind === 'sending' && o.at === event.at ? { ...o, kind: 'sent' } : o;
    case 'refused':
      return o.kind === 'sending' && o.at === event.at
        ? { kind: 'failed', text: o.text, error: event.error, at: o.at, after: o.after }
        : o;
    case 'reset':
      return IDLE;
  }
}

/** The copy of my message shown until the stored one arrives; null once it has. */
export function pendingLine(o: Outgoing, newestMine: string | null): ChatLine | null {
  if (o.kind === 'idle' || newestMine !== o.after) return null;
  return { id: 'pending', mine: true, text: o.text };
}

/** A file being attached: `fileId` is the core's id, null until the upload is done. */
export type Attachment = PendingFile & { fileId: string | null };

let uploads = 0;
/** A key for a file's row while it uploads; only this page sees it. */
export const uploadKey = () => `upload-${++uploads}`;

/** The upload finished. A file removed while it uploaded stays removed. */
export function uploaded(
  files: Attachment[],
  key: string,
  done: { fileId: string; name: string; detail: string },
): Attachment[] {
  return files.map((f) => (f.id === key ? { ...f, ...done, state: 'ready' } : f));
}

/** After a send is accepted: only the files that went with it leave the list. */
export function withoutSent(files: Attachment[], fileIds: readonly string[]): Attachment[] {
  return files.filter((f) => f.fileId === null || !fileIds.includes(f.fileId));
}
