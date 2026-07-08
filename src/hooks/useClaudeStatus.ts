'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

const BASE_INTERVAL = 30_000;
const BACKED_OFF_INTERVAL = 60_000;
const STABLE_THRESHOLD = 3;

export interface ClaudeStatus {
  connected: boolean;
  version: string | null;
  latestVersion?: string | null;
  updateAvailable?: boolean;
  manualUpdateChannel?: boolean;
  binaryPath?: string | null;
  installType?: string | null;
  otherInstalls?: Array<{ path: string; type: string }>;
  missingGit?: boolean;
  warnings?: string[];
  features?: Record<string, boolean>;
}

/**
 * Reusable hook for Claude Code CLI status polling.
 * Extracted from ConnectionStatus.tsx for shared use in settings page.
 */
export function useClaudeStatus() {
  const [status, setStatus] = useState<ClaudeStatus | null>(null);
  const stableCountRef = useRef(0);
  const lastConnectedRef = useRef<boolean | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const checkRef = useRef<() => void>(() => {});

  const schedule = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    const interval = stableCountRef.current >= STABLE_THRESHOLD
      ? BACKED_OFF_INTERVAL
      : BASE_INTERVAL;
    timerRef.current = setTimeout(() => checkRef.current(), interval);
  }, []);

  const checkStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/claude-status');
      if (res.ok) {
        const data: ClaudeStatus = await res.json();
        if (lastConnectedRef.current === data.connected) {
          stableCountRef.current++;
        } else {
          stableCountRef.current = 0;
        }
        lastConnectedRef.current = data.connected;
        setStatus(data);
      }
    } catch {
      if (lastConnectedRef.current === false) {
        stableCountRef.current++;
      } else {
        stableCountRef.current = 0;
      }
      lastConnectedRef.current = false;
      setStatus({ connected: false, version: null });
    }
    schedule();
  }, [schedule]);

  useEffect(() => {
    checkRef.current = checkStatus;
  }, [checkStatus]);

  useEffect(() => {
    // Schedule initial check on next tick to avoid synchronous setState in effect
    const timer = setTimeout(() => checkStatus(), 0);
    return () => {
      clearTimeout(timer);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [checkStatus]);

  const refresh = useCallback(() => {
    stableCountRef.current = 0;
    checkStatus();
  }, [checkStatus]);

  const invalidateAndRefresh = useCallback(async () => {
    try {
      await fetch('/api/claude-status/invalidate', { method: 'POST' });
    } catch { /* best-effort */ }
    stableCountRef.current = 0;
    checkStatus();
  }, [checkStatus]);

  return { status, refresh, invalidateAndRefresh };
}
