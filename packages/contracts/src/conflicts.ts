/**
 * Who answers a save refused as stale (`expected_rev`). An open editor holds its row's id and
 * offers Keep mine or Take theirs itself; a save whose editor is gone (closed, or a page
 * reloaded while the change waited offline) is rescued by the queue instead, so no text is lost.
 */
const holds = new Map<string, number>();

/** Hold a row's conflicts while an editor is open on it. Returns the release. */
export function holdConflicts(id: string): () => void {
  holds.set(id, (holds.get(id) ?? 0) + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const n = (holds.get(id) ?? 1) - 1;
    if (n > 0) holds.set(id, n);
    else holds.delete(id);
  };
}

export function conflictsHeld(id: string): boolean {
  return holds.has(id);
}
