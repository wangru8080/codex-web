import type { FuzzyFileSearchResult } from "@/codex/protocol/generated/FuzzyFileSearchResult";
import type { Thread } from "@/codex/protocol/generated/v2/Thread";
import type { ThreadListParams } from "@/codex/protocol/generated/v2/ThreadListParams";

export type GlobalSearchSession = {
  type: "session";
  id: string;
  title: string;
  projectName: string;
  updatedAt: string;
};

export type GlobalSearchFile = {
  type: "file";
  sessionId: string;
  sessionTitle: string;
  path: string;
  name: string;
  nodeType: "file" | "directory";
};

export type ActiveGlobalSearchThread = {
  id: string;
  title: string;
  cwd: string;
};

export function buildGlobalThreadSearchParams(query: string): ThreadListParams {
  return {
    archived: false,
    cursor: null,
    limit: 50,
    searchTerm: query.trim(),
    sortDirection: "desc",
    sortKey: "recency_at",
  };
}

export function threadToGlobalSearchSession(thread: Thread): GlobalSearchSession {
  return {
    type: "session",
    id: thread.id,
    title: thread.name?.trim() || thread.preview.trim() || "Codex 会话",
    projectName: projectNameFromCwd(thread.cwd),
    updatedAt: new Date(thread.updatedAt * 1000).toISOString(),
  };
}

export function buildGlobalFileSearchRoots(
  workingDirectory: string,
  threads: readonly Thread[],
): string[] {
  const roots = new Set<string>();
  const current = workingDirectory.trim();
  if (current) roots.add(current);
  for (const thread of threads) {
    const cwd = thread.cwd.trim();
    if (cwd) roots.add(cwd);
  }
  return [...roots];
}

export function fuzzyFileToGlobalSearchResult(
  file: FuzzyFileSearchResult,
  threads: readonly Thread[],
  activeThread: ActiveGlobalSearchThread | null,
): GlobalSearchFile | null {
  const thread = activeThread?.cwd === file.root
    ? activeThread
    : newestThreadForRoot(threads, file.root);
  if (!thread) return null;

  return {
    type: "file",
    sessionId: thread.id,
    sessionTitle: "preview" in thread
      ? thread.name?.trim() || thread.preview.trim() || "Codex 会话"
      : thread.title,
    path: absoluteSearchPath(file.root, file.path),
    name: file.file_name,
    nodeType: file.match_type,
  };
}

function newestThreadForRoot(threads: readonly Thread[], root: string): Thread | null {
  let newest: Thread | null = null;
  for (const thread of threads) {
    if (thread.cwd !== root) continue;
    if (!newest || thread.updatedAt > newest.updatedAt) newest = thread;
  }
  return newest;
}

function absoluteSearchPath(root: string, filePath: string): string {
  if (/^(?:[A-Za-z]:[\\/]|[\\/]{1,2})/.test(filePath)) return filePath;
  const separator = root.includes("\\") && !root.includes("/") ? "\\" : "/";
  return `${root.replace(/[\\/]+$/, "")}${separator}${filePath.replace(/^[\\/]+/, "")}`;
}

function projectNameFromCwd(cwd: string): string {
  const trimmed = cwd.replace(/[\\/]+$/, "");
  return trimmed.split(/[\\/]/).pop() || cwd;
}
