import { afterEach, describe, expect, it, vi } from "vitest";

import {
  formatRelativeTime,
  groupSessionsByProject,
} from "@/components/layout/chat-list-utils";
import type { TranslationKey } from "@/i18n";
import type { ChatSession } from "@/types";

const translate = (
  key: TranslationKey,
  params?: Record<string, string | number>,
) => `${key}:${params?.n ?? ""}`;

afterEach(() => vi.useRealTimers());

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
