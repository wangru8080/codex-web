"use client";

import { useState, useCallback } from "react";
import type { GitBranch } from "@/types";

export function useGitBranches(cwd: string) {
  const [branches, setBranches] = useState<GitBranch[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetch_ = useCallback(async () => {
    if (!cwd) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/git/branches?cwd=${encodeURIComponent(cwd)}`);
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to fetch branches');
      }
      const data = await res.json();
      setBranches(data.branches);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch branches');
    } finally {
      setLoading(false);
    }
  }, [cwd]);

  return { branches, loading, error, fetch: fetch_ };
}
