"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { GitStatus } from "@/types";

const POLL_INTERVAL = 10000; // 10s

export function useGitStatus(cwd: string) {
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchStatus = useCallback(async () => {
    if (!cwd) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/git/status?cwd=${encodeURIComponent(cwd)}`);
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to fetch status');
      }
      const data: GitStatus = await res.json();
      setStatus(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch status');
    } finally {
      setLoading(false);
    }
  }, [cwd]);

  // Initial fetch + polling
  useEffect(() => {
    if (!cwd) {
      setStatus(null);
      return;
    }

    fetchStatus();

    intervalRef.current = setInterval(fetchStatus, POLL_INTERVAL);

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        fetchStatus();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    // Listen for manual refresh events (e.g. after commit from topbar)
    const handleRefreshEvent = () => fetchStatus();
    window.addEventListener('git-refresh', handleRefreshEvent);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('git-refresh', handleRefreshEvent);
    };
  }, [cwd, fetchStatus]);

  return { status, loading, error, refresh: fetchStatus };
}
