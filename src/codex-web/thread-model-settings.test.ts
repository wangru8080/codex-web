import { describe, expect, it } from "vitest";

import type { ThreadSettings } from "@/codex/protocol/generated/v2/ThreadSettings";
import {
  buildThreadModelSettingsUpdate,
  modelSettingsFromResume,
} from "./thread-model-settings";

const currentSettings = {
  cwd: "/repo",
  approvalPolicy: "on-request",
  approvalsReviewer: "user",
  sandboxPolicy: {
    type: "workspaceWrite",
    writableRoots: ["/repo"],
    networkAccess: false,
    excludeTmpdirEnvVar: false,
    excludeSlashTmp: false,
  },
  activePermissionProfile: { id: ":workspace", extends: null },
  model: "gpt-5.5",
  modelProvider: "openai",
  serviceTier: null,
  effort: "low",
  summary: null,
  collaborationMode: {
    mode: "default",
    settings: {
      model: "gpt-5.5",
      reasoning_effort: "low",
      developer_instructions: null,
    },
  },
  personality: null,
} satisfies ThreadSettings;

describe("buildThreadModelSettingsUpdate", () => {
  it("模型选择只更新目标线程并同步 collaboration mode 模型", () => {
    expect(buildThreadModelSettingsUpdate({
      threadId: "thread-a",
      model: "gpt-5.6-sol",
      currentSettings,
    })).toEqual({
      threadId: "thread-a",
      model: "gpt-5.6-sol",
      collaborationMode: {
        mode: "default",
        settings: {
          model: "gpt-5.6-sol",
          reasoning_effort: "low",
          developer_instructions: null,
        },
      },
    });
  });

  it("推理等级选择只更新目标线程并同步 collaboration mode effort", () => {
    expect(buildThreadModelSettingsUpdate({
      threadId: "thread-b",
      effort: "high",
      currentSettings,
    })).toEqual({
      threadId: "thread-b",
      effort: "high",
      collaborationMode: {
        mode: "default",
        settings: {
          model: "gpt-5.5",
          reasoning_effort: "high",
          developer_instructions: null,
        },
      },
    });
  });
});

describe("modelSettingsFromResume", () => {
  it("使用 thread/resume 的模型和推理等级恢复输入框", () => {
    expect(modelSettingsFromResume({
      model: "gpt-5.6-sol",
      reasoningEffort: "high",
    })).toEqual({ model: "gpt-5.6-sol", effort: "high" });
  });
});
