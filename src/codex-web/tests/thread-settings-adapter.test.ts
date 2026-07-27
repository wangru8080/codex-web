import { describe, expect, it } from "vitest";

import type { ThreadSettings } from "@/codex/protocol/generated/v2/ThreadSettings";
import { reduceThreadSettingsNotification } from "../thread-settings-adapter";

const settings = {
  cwd: "/repo",
  approvalPolicy: "on-request",
  approvalsReviewer: "auto_review",
  sandboxPolicy: {
    type: "workspaceWrite",
    writableRoots: ["/repo"],
    networkAccess: false,
    excludeTmpdirEnvVar: false,
    excludeSlashTmp: false,
  },
  activePermissionProfile: { id: ":workspace", extends: null },
  model: "gpt-5.6-sol",
  modelProvider: "openai",
  serviceTier: null,
  effort: "high",
  summary: null,
  collaborationMode: { mode: "default", settings: { model: "gpt-5.6-sol", reasoning_effort: "high", developer_instructions: null } },
  personality: null,
} satisfies ThreadSettings;

describe("reduceThreadSettingsNotification", () => {
  it("只用 thread/settings/updated 更新真实线程权限状态", () => {
    const previous = {};
    expect(reduceThreadSettingsNotification(previous, { method: "turn/started", params: {} })).toBe(previous);
    expect(reduceThreadSettingsNotification(previous, {
      method: "thread/settings/updated",
      params: { threadId: "thread-1", threadSettings: settings },
    })).toEqual({
      "thread-1": { source: "app-server.notification", data: settings },
    });
  });
});
