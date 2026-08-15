'use client';

import { useEffect, useState, useRef } from 'react';
import type { MentionRef } from '@/types';
import { useAppServerActions } from '@/codex-web/AppServerProvider';
import type { FsReadDirectoryResponse } from '@/codex/protocol/generated/v2/FsReadDirectoryResponse';

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
  /** Workspace root used to resolve mention paths on the app-server target. */
  workingDirectory?: string;
  /** Active chat session id, used only to isolate the estimate cache. */
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

export async function estimateMentionFileTokens(
  path: string,
  workingDirectory: string | undefined,
  getFileSize: (path: string) => Promise<number>,
): Promise<number | null> {
  try {
    if (!workingDirectory) return null;
    const abs = joinPath(workingDirectory, path);
    const bytes = await getFileSize(abs);
    return Math.ceil(bytes * TOKEN_PER_BYTE);
  } catch {
    return null;
  }
}

export async function estimateMentionDirectoryTokens(
  path: string,
  workingDirectory: string | undefined,
  readDirectory: (path: string) => Promise<FsReadDirectoryResponse>,
): Promise<number | null> {
  if (!workingDirectory) return null;
  try {
    const dir = joinPath(workingDirectory, path);
    const response = await readDirectory(dir);
    const tree = response.entries;
    // Roughly mirrors fetchDirectorySummary's "Directory reference @path/\n- name1/\n- name2..." format
    const previewChars = tree
      .slice(0, 30)
      .reduce((acc, node) => acc + node.fileName.length + 4, 0);
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
  const { getFileSize, readDirectory } = useAppServerActions();
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
          ? estimateMentionDirectoryTokens(m.path, options?.workingDirectory, readDirectory)
          : estimateMentionFileTokens(m.path, options?.workingDirectory, getFileSize);
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
  }, [getFileSize, mentions, options?.sessionId, options?.workingDirectory, readDirectory]);

  return estimates;
}
