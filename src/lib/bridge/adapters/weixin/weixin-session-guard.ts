/**
 * Session guard for WeChat accounts.
 *
 * Tracks pause state per account (e.g., after errcode -14 session expired).
 * Pause durations are per-account and stored in memory.
 */

const PAUSE_DURATION_MS = 60 * 60 * 1000; // 60 minutes

interface AccountPauseState {
  pausedAt: number;
  resumeAt: number;
  reason: string;
}

const pauseStates = new Map<string, AccountPauseState>();

/**
 * Check if an account is currently paused.
 */
export function isPaused(accountId: string): boolean {
  const state = pauseStates.get(accountId);
  if (!state) return false;
  if (Date.now() >= state.resumeAt) {
    // Pause expired — auto-clear
    pauseStates.delete(accountId);
    return false;
  }
  return true;
}

/**
 * Get remaining pause time in milliseconds, or 0 if not paused.
 */
export function getPauseRemainingMs(accountId: string): number {
  const state = pauseStates.get(accountId);
  if (!state) return 0;
  const remaining = state.resumeAt - Date.now();
  if (remaining <= 0) {
    pauseStates.delete(accountId);
    return 0;
  }
  return remaining;
}

/**
 * Pause an account for the default duration (60 minutes).
 */
export function setPaused(accountId: string, reason: string = 'Session expired'): void {
  const now = Date.now();
  pauseStates.set(accountId, {
    pausedAt: now,
    resumeAt: now + PAUSE_DURATION_MS,
    reason,
  });
  console.log(`[weixin-session-guard] Account ${accountId} paused for 60 min: ${reason}`);
}

/**
 * Clear pause state for an account.
 */
export function clearPause(accountId: string): void {
  pauseStates.delete(accountId);
}

/**
 * Clear all pause states.
 */
export function clearAllPauses(): void {
  pauseStates.clear();
}
