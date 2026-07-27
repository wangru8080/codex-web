import { describe, expect, it } from "vitest";

import { groupSessionsByProject } from "@/components/layout/chat-list-utils";
import type { ChatSession } from "@/types";

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
