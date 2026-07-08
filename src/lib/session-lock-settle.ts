/**
 * session-lock-settle.ts — one-shot session-lock settler.
 *
 * codex-stop-recovery Phase 3. `POST /api/chat` holds a session lock for the
 * duration of a turn and renews it every 60s; the lock is normally released in
 * `collectStreamResponse`'s completion callback. But if the underlying turn
 * never produces a terminal event (a Codex turn that was Stopped but emits no
 * `turn/completed`, an upstream stuck turn, etc.), the background collect never
 * finishes, the renewal interval never stops, and the lock is renewed forever —
 * the next same-session send gets `SESSION_BUSY` indefinitely.
 *
 * To bound that, BOTH the normal completion path AND a Stop/abort watchdog call
 * the same settler. It must:
 *   - run its side effects AT MOST ONCE (whichever path fires first wins; the
 *     other becomes a no-op — so a late natural completion can't double-release
 *     or flip status back);
 *   - ALWAYS stop the renewal interval;
 *   - only touch runtime status when `releaseLock()` reports we STILL OWNED the
 *     lock. `releaseSessionLock(sessionId, lockId)` in db.ts is lockId-scoped
 *     (deletes only the row matching this lockId), so releasing a stale lockId
 *     after a newer same-session request took over is a no-op that returns
 *     false. `setSessionRuntimeStatus` is session-scoped (no lockId), so writing
 *     status unconditionally would clobber the newer request's 'running' state.
 *     Gating the status write on ownership keeps the two stores consistent.
 *
 * Pure + dependency-injected so the invariants above are unit-testable without
 * a DB or a live stream (mirrors `stopStreamWith` in stream-session-manager.ts).
 */
export interface SessionLockSettleDeps {
  /** Stop the lock-renewal interval. Must be safe to call once. */
  clearRenewal: () => void;
  /**
   * Release THIS turn's lock. Returns true iff this lockId was still the
   * active lock (i.e. we still owned the session) — false if it had already
   * been released or a newer request took over.
   */
  releaseLock: () => boolean;
  /** Write the session runtime status. Only called when we still owned the lock. */
  setStatus: (status: string) => void;
}

/**
 * Build a one-shot settler. Call the returned function with the terminal
 * status to report (`'idle'` for normal completion, `'interrupted'` for the
 * Stop/abort watchdog). Subsequent calls are no-ops.
 */
export function createSessionLockSettler(
  deps: SessionLockSettleDeps,
): (status: string) => void {
  let settled = false;
  return (status: string) => {
    if (settled) return;
    settled = true;
    deps.clearRenewal();
    const stillOwned = deps.releaseLock();
    if (stillOwned) {
      deps.setStatus(status);
    }
  };
}
