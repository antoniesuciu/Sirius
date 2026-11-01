let lastMs = 0;

/**
 * UUIDv7 (RFC 9562): time-ordered, so ids sort by creation, which suits a future sync.
 *
 * The timestamp is forced to increase on every call. Ordering by id is how this codebase
 * means "in creation order" (messages, undo), and two ids minted in the same millisecond
 * would otherwise compare on their random bits.
 */
export function uuidv7(now: number = Date.now()): string {
  const ms = Math.max(now, lastMs + 1);
  lastMs = ms;
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  for (let i = 0; i < 6; i += 1) {
    bytes[i] = Math.floor(ms / 2 ** (8 * (5 - i))) % 256;
  }
  bytes[6] = ((bytes[6] as number) & 0x0f) | 0x70;
  bytes[8] = ((bytes[8] as number) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
