'use client';

import { useEffect, useState, useRef } from 'react';
import type { MentionRef } from '@/types';

/**
 * Estimate the token cost of pending @ mention chips so the user can
 * tell — before sending — roughly how much context they're about to
 * spend. Estimation is intentionally cheap and approximate
 * (`bytes/4 ≈ tokens`); the goal is a rough order-of-magnitude
 * indicator on the chip ("~3.2K"), not precise accounting. A real
 * tokenizer pass would only matter once we surface a specific
 * "compress / replace" workflow, which is not in Phase 1.
 *
 * Cache lives at module scope so toggling chips on/off doesn't refire
 * the same fetch within a session.
 */

interface Options {
  /** Workspace root — required to resolve absolute paths for mentions
   *  inserted before a session has been created (chat/page.tsx). When
   *  omitted, the hook uses `/api/files/serve?sessionId=...&path=...`. */
  workingDirectory?: string;
  /** Active chat session id; used by the file-serve endpoint to
   *  enforce path safety. Pass undefined on the new-chat page. */
  sessionId?: string;
}

const TOKEN_PER_BYTE = 1 / 4;
const MAX_CACHE_SIZE = 200;
const tokenCache = new Map<string, number>();
const inflight = new Map<string, Promise<number | null>>();

function pruneCache() {
  if (tokenCache.size <= MAX_CACHE_SIZE) return;
  // Drop the oldest ~25% in insertion order — Map iteration order is
  // insertion order so the first keys are the oldest.
  const drop = Math.ceil(MAX_CACHE_SIZE / 4);
  let i = 0;
  for (const key of tokenCache.keys()) {
    if (i++ >= drop) break;
    tokenCache.delete(key);
  }
}

function joinPath(base: string, rel: string): string {
  const b = base.replace(/[\\/]+$/, '');
  const r = rel.replace(/^[\\/]+/, '');
  return `${b}/${r}`;
}

function cacheKey(mention: MentionRef, sessionId?: string, workingDirectory?: string): string {
  const root = sessionId ?? workingDirectory ?? 'unknown';
  return `${mention.nodeType ?? 'file'}::${root}::${mention.path}`;
}

async function estimateFile(path: string, sessionId?: string, workingDirectory?: string): Promise<number | null> {
  try {
    if (sessionId) {
      const res = await fetch(`/api/files/serve?sessionId=${encodeURIComponent(sessionId)}&path=${encodeURIComponent(path)}`, {
        method: 'HEAD',
      });
      if (!res.ok) return null;
      const len = Number.parseInt(res.headers.get('content-length') || '', 10);
      return Number.isFinite(len) ? Math.ceil(len * TOKEN_PER_BYTE) : null;
    }
    if (!workingDirectory) return null;
    const abs = joinPath(workingDirectory, path);
    const res = await fetch(`/api/files/raw?path=${encodeURIComponent(abs)}`, { method: 'HEAD' });
    if (!res.ok) return null;
    const len = Number.parseInt(res.headers.get('content-length') || '', 10);
    return Number.isFinite(len) ? Math.ceil(len * TOKEN_PER_BYTE) : null;
  } catch {
    return null;
  }
}

async function estimateDirectory(path: string, workingDirectory?: string): Promise<number | null> {
  if (!workingDirectory) return null;
  try {
    const dir = joinPath(workingDirectory, path);
    const res = await fetch(`/api/files?dir=${encodeURIComponent(dir)}&baseDir=${encodeURIComponent(workingDirectory)}&depth=2`);
    if (!res.ok) return null;
    const data = await res.json();
    const tree = Array.isArray(data.tree) ? data.tree : [];
    // Roughly mirrors fetchDirectorySummary's "Directory reference @path/\n- name1/\n- name2..." format
    const previewChars = tree
      .slice(0, 30)
      .reduce((acc: number, node: { name?: string; type?: string }) => acc + (node.name?.length ?? 0) + 4, 0);
    const headerChars = `Directory reference @${path}/\n`.length;
    return Math.ceil((previewChars + headerChars) * TOKEN_PER_BYTE);
  } catch {
    return null;
  }
}

export function useMentionTokenEstimate(
  mentions: MentionRef[],
  options?: Options,
): Record<string, number | null> {
  const [estimates, setEstimates] = useState<Record<string, number | null>>({});
  // Track which keys we've already kicked off this hook instance, so
  // re-renders don't refire pending requests.
  const seenRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    for (const m of mentions) {
      const key = cacheKey(m, options?.sessionId, options?.workingDirectory);
      if (seenRef.current.has(key)) continue;
      seenRef.current.add(key);

      const cached = tokenCache.get(key);
      if (cached !== undefined) {
        setEstimates(prev => (prev[m.path] === cached ? prev : { ...prev, [m.path]: cached }));
        continue;
      }
      // Mark as "fetching" so chip can show a placeholder.
      setEstimates(prev => ({ ...prev, [m.path]: null }));

      let p = inflight.get(key);
      if (!p) {
        p = m.nodeType === 'directory'
          ? estimateDirectory(m.path, options?.workingDirectory)
          : estimateFile(m.path, options?.sessionId, options?.workingDirectory);
        inflight.set(key, p);
      }
      p.then(tokens => {
        inflight.delete(key);
        if (tokens != null) {
          tokenCache.set(key, tokens);
          pruneCache();
        }
        if (cancelled) return;
        setEstimates(prev => (prev[m.path] === tokens ? prev : { ...prev, [m.path]: tokens }));
      });
    }
    return () => {
      cancelled = true;
    };
  }, [mentions, options?.sessionId, options?.workingDirectory]);

  return estimates;
}
