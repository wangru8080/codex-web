"use client";

import { useState, useCallback } from "react";
import type { GitWorktree } from "@/types";

export function useGitWorktrees(cwd: string) {
  const [worktrees, setWorktrees] = useState<GitWorktree[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetch_ = useCallback(async () => {
    if (!cwd) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/git/worktrees?cwd=${encodeURIComponent(cwd)}`);
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to fetch worktrees');
      }
      const data = await res.json();
      setWorktrees(data.worktrees);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch worktrees');
    } finally {
      setLoading(false);
    }
  }, [cwd]);

  return { worktrees, loading, error, fetch: fetch_ };
}
