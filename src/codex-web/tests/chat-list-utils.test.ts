import { afterEach, describe, expect, it, vi } from "vitest";

import {
  formatRelativeTime,
  groupSessionsByProject,
  loadPinnedProjects,
  loadPinnedSessions,
  partitionPinnedSidebar,
  savePinnedProjects,
  savePinnedSessions,
} from "@/components/layout/chat-list-utils";
import type { TranslationKey } from "@/i18n";
import type { ChatSession } from "@/types";

const translate = (
  key: TranslationKey,
  params?: Record<string, string | number>,
) => `${key}:${params?.n ?? ""}`;

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
}

function createSession(overrides: Partial<ChatSession> = {}): ChatSession {
  return {
    id: "thread-web",
    title: "已有会话",
    created_at: "2026-07-19T00:00:00.000Z",
    updated_at: "2026-07-19T00:00:00.000Z",
    model: "gpt-5",
    system_prompt: "",
    working_directory: "/repo/web",
    sdk_session_id: "",
    project_name: "web",
    status: "active",
    provider_name: "Codex",
    provider_id: "codex_account",
    runtime_pin: "codex_runtime",
    sdk_cwd: "",
    runtime_status: "",
    runtime_updated_at: "",
    runtime_error: "",
    ...overrides,
  };
}

describe("groupSessionsByProject", () => {
  it("当前项目尚无会话时仍优先显示项目文件夹", () => {
    const groups = groupSessionsByProject([createSession()], "/repo/Chat");

    expect(groups.map((group) => group.workingDirectory)).toEqual([
      "/repo/Chat",
      "/repo/web",
    ]);
    expect(groups[0]).toMatchObject({
      displayName: "Chat",
      sessions: [],
    });
  });

  it("当前项目已有会话时不生成重复项目", () => {
    const groups = groupSessionsByProject([createSession()], "/repo/web");

    expect(groups).toHaveLength(1);
    expect(groups[0]?.sessions).toHaveLength(1);
  });

  it("没有当前目录和会话时不生成虚假项目", () => {
    expect(groupSessionsByProject([])).toEqual([]);
  });
});

describe("partitionPinnedSidebar", () => {
  it("单独置顶会话后从普通项目中移除且不影响同项目其他会话", () => {
    const pinned = createSession({ id: "thread-pinned", title: "置顶会话" });
    const regular = createSession({ id: "thread-regular", title: "普通会话" });
    const groups = groupSessionsByProject([pinned, regular]);

    const result = partitionPinnedSidebar(groups, new Set(), new Set([pinned.id]));

    expect(result.pinnedSessions.map((session) => session.id)).toEqual([pinned.id]);
    expect(result.pinnedProjects).toEqual([]);
    expect(result.regularProjects[0]?.sessions.map((session) => session.id)).toEqual([
      regular.id,
    ]);
  });

  it("项目置顶覆盖内部会话置顶显示且普通项目不重复", () => {
    const session = createSession({ id: "thread-pinned" });
    const groups = groupSessionsByProject([
      session,
      createSession({ id: "thread-other", working_directory: "/repo/other" }),
    ]);

    const result = partitionPinnedSidebar(
      groups,
      new Set(["/repo/web"]),
      new Set([session.id]),
    );

    expect(result.pinnedSessions).toEqual([]);
    expect(result.pinnedProjects.map((group) => group.workingDirectory)).toEqual([
      "/repo/web",
    ]);
    expect(result.regularProjects.map((group) => group.workingDirectory)).toEqual([
      "/repo/other",
    ]);
  });

  it("过期置顶键没有匹配内容时不生成虚假置顶分组", () => {
    const groups = groupSessionsByProject([createSession()]);

    const result = partitionPinnedSidebar(
      groups,
      new Set(["/repo/missing"]),
      new Set(["thread-missing"]),
    );

    expect(result.pinnedSessions).toEqual([]);
    expect(result.pinnedProjects).toEqual([]);
    expect(result.regularProjects).toEqual(groups);
  });
});

describe("sidebar pin storage", () => {
  it("分别持久化项目路径和会话 ID", () => {
    const storage = memoryStorage();
    vi.stubGlobal("window", { localStorage: storage });

    savePinnedProjects(new Set(["/repo/web"]));
    savePinnedSessions(new Set(["thread-web"]));

    expect(loadPinnedProjects()).toEqual(new Set(["/repo/web"]));
    expect(loadPinnedSessions()).toEqual(new Set(["thread-web"]));
  });

  it("存储内容损坏时安全回退为空集合", () => {
    const storage = memoryStorage({
      "codex-web:pinned-projects": "{bad json",
      "codex-web:pinned-sessions": JSON.stringify(["thread-web", 42]),
    });
    vi.stubGlobal("window", { localStorage: storage });

    expect(loadPinnedProjects()).toEqual(new Set());
    expect(loadPinnedSessions()).toEqual(new Set());
  });
});

describe("formatRelativeTime", () => {
  it("超过一周和数百天的会话仍显示具体天数", () => {
    vi.setSystemTime(new Date("2026-07-27T12:00:00.000Z"));

    expect(formatRelativeTime("2026-07-19T12:00:00.000Z", translate)).toBe(
      "chatList.daysAgo:8",
    );
    expect(formatRelativeTime("2025-06-22T12:00:00.000Z", translate)).toBe(
      "chatList.daysAgo:400",
    );
  });

  it("不足一天时仍显示小时数", () => {
    vi.setSystemTime(new Date("2026-07-27T12:00:00.000Z"));

    expect(formatRelativeTime("2026-07-26T13:00:00.000Z", translate)).toBe(
      "chatList.hoursAgo:23",
    );
  });
});
