import { parseDBDate } from "@/lib/utils";
import type { ChatSession } from "@/types";
import type { TranslationKey } from "@/i18n";

const COLLAPSED_PROJECTS_KEY = "codepilot:collapsed-projects";
export const COLLAPSED_INITIALIZED_KEY = "codepilot:collapsed-initialized";

export function loadCollapsedProjects(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = localStorage.getItem(COLLAPSED_PROJECTS_KEY);
    if (raw) return new Set(JSON.parse(raw));
  } catch {
    // ignore
  }
  return new Set();
}

export function saveCollapsedProjects(collapsed: Set<string>) {
  localStorage.setItem(COLLAPSED_PROJECTS_KEY, JSON.stringify([...collapsed]));
}

export interface ProjectGroup {
  workingDirectory: string;
  displayName: string;
  sessions: ChatSession[];
  latestUpdatedAt: number;
}

function codexSessionKey(session: ChatSession): string {
  return session.codex_session_id || session.codex_home_session_id || "";
}

function adoptCodexDisplaySession(adopted: ChatSession, codex: ChatSession): ChatSession {
  return {
    ...adopted,
    title: codex.title,
    created_at: codex.created_at,
    updated_at: codex.updated_at,
    model: codex.model || adopted.model,
    working_directory: codex.working_directory || adopted.working_directory,
    project_name: codex.project_name || adopted.project_name,
    codex_session_id: codex.codex_session_id,
    model_provider: codex.model_provider,
    codex_home_session_id: adopted.codex_home_session_id || codex.codex_session_id,
    codex_home_model_provider: adopted.codex_home_model_provider || codex.model_provider,
  };
}

export function mergeSessionsForDisplay(
  dbSessions: ChatSession[],
  codexSessions: ChatSession[],
): ChatSession[] {
  const adoptedByCodexId = new Map<string, ChatSession>();
  for (const session of dbSessions) {
    if (session.codex_home_session_id) {
      adoptedByCodexId.set(session.codex_home_session_id, session);
    }
  }

  const displayedCodexIds = new Set<string>();
  const merged: ChatSession[] = [];
  for (const codexSession of codexSessions) {
    const key = codexSessionKey(codexSession);
    if (key) displayedCodexIds.add(key);
    const adopted = key ? adoptedByCodexId.get(key) : undefined;
    merged.push(adopted ? adoptCodexDisplaySession(adopted, codexSession) : codexSession);
  }

  for (const session of dbSessions) {
    const key = codexSessionKey(session);
    if (key && displayedCodexIds.has(key)) continue;
    merged.push(session);
  }

  return merged;
}

export function groupSessionsByProject(
  sessions: ChatSession[],
  activeWorkingDirectory = "",
): ProjectGroup[] {
  const map = new Map<string, ChatSession[]>();
  for (const session of sessions) {
    const key = session.working_directory || "";
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(session);
  }
  if (activeWorkingDirectory.trim() && !map.has(activeWorkingDirectory)) {
    map.set(activeWorkingDirectory, []);
  }

  const groups: ProjectGroup[] = [];
  for (const [wd, groupSessions] of map) {
    // Sort sessions within group by updated_at DESC
    groupSessions.sort(
      (a, b) =>
        parseDBDate(b.updated_at).getTime() - parseDBDate(a.updated_at).getTime()
    );
    const displayName =
      wd === ""
        ? "No Project"
        : groupSessions[0]?.project_name || wd.split("/").pop() || wd;
    const latestUpdatedAt = groupSessions[0]
      ? parseDBDate(groupSessions[0].updated_at).getTime()
      : 0;
    groups.push({
      workingDirectory: wd,
      displayName,
      sessions: groupSessions,
      latestUpdatedAt,
    });
  }

  // 当前项目即使还没有会话，也应立即出现在项目列表顶部。
  groups.sort((a, b) => {
    if (activeWorkingDirectory) {
      if (a.workingDirectory === activeWorkingDirectory) return -1;
      if (b.workingDirectory === activeWorkingDirectory) return 1;
    }
    return b.latestUpdatedAt - a.latestUpdatedAt;
  });
  return groups;
}

export function formatRelativeTime(dateStr: string, t: (key: TranslationKey, params?: Record<string, string | number>) => string): string {
  const date = parseDBDate(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffMin < 1) return t('chatList.justNow');
  if (diffMin < 60) return t('chatList.minutesAgo', { n: diffMin });
  if (diffHr < 24) return t('chatList.hoursAgo', { n: diffHr });
  if (diffDay < 7) return t('chatList.daysAgo', { n: diffDay });
  return date.toLocaleDateString();
}
