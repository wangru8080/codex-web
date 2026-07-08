"use client";

import { useState, useCallback } from "react";
import type { GitLogEntry } from "@/types";

export function useGitLog(cwd: string) {
  const [entries, setEntries] = useState<GitLogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetch_ = useCallback(async (limit = 50) => {
    if (!cwd) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/git/log?cwd=${encodeURIComponent(cwd)}&limit=${limit}`);
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to fetch log');
      }
      const data = await res.json();
      setEntries(data.entries);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch log');
    } finally {
      setLoading(false);
    }
  }, [cwd]);

  return { entries, loading, error, fetch: fetch_ };
}
