import { describe, expect, it } from "vitest";
import type { ThreadStartParams } from "@/codex/protocol/generated/v2/ThreadStartParams";
import type { TurnStartParams } from "@/codex/protocol/generated/v2/TurnStartParams";

import {
  planCollaborationModeForRequest,
  turnCollaborationModeForRequest,
  withPlanCollaborationMode,
  withTurnCollaborationMode,
} from "../app-server-collaboration-mode";

describe("app-server collaboration mode params", () => {
  it("Plan mode 生成 app-server collaborationMode", () => {
    expect(planCollaborationModeForRequest("plan", "gpt-5.5")).toEqual({
      mode: "plan",
      settings: {
        model: "gpt-5.5",
        reasoning_effort: null,
        developer_instructions: null,
      },
    });
  });

  it("Default/code mode 不传 collaborationMode", () => {
    expect(planCollaborationModeForRequest("code", "gpt-5.5")).toBeNull();
    expect(planCollaborationModeForRequest(undefined, "gpt-5.5")).toBeNull();
  });

  it("Default/code mode 的 turn 显式切回 default collaboration mode", () => {
    expect(turnCollaborationModeForRequest("code", "gpt-5.5")).toEqual({
      mode: "default",
      settings: {
        model: "gpt-5.5",
        reasoning_effort: null,
        developer_instructions: null,
      },
    });
    expect(turnCollaborationModeForRequest(undefined, "gpt-5.5").mode).toBe("default");
  });

  it("只在 Plan mode 给请求参数追加 collaborationMode", () => {
    const params: ThreadStartParams = { model: "gpt-5.5" };
    expect(withPlanCollaborationMode(params, "code", "gpt-5.5")).toEqual({
      model: "gpt-5.5",
    });
    expect(withPlanCollaborationMode(params, "plan", "gpt-5.5")).toEqual({
      model: "gpt-5.5",
      collaborationMode: {
        mode: "plan",
        settings: {
          model: "gpt-5.5",
          reasoning_effort: null,
          developer_instructions: null,
        },
      },
    });
  });

  it("thread/start 使用显式兼容类型追加 collaborationMode", () => {
    const params: ThreadStartParams = {
      cwd: "/tmp/project",
      model: "gpt-5.5",
      approvalPolicy: "on-request",
      threadSource: "codex_web",
      serviceName: "codex_web",
    };

    const result = withPlanCollaborationMode(params, "plan", "gpt-5.5");

    expect(result).toMatchObject({
      cwd: "/tmp/project",
      model: "gpt-5.5",
      collaborationMode: {
        mode: "plan",
        settings: {
          model: "gpt-5.5",
          reasoning_effort: null,
          developer_instructions: null,
        },
      },
    });
  });

  it("turn/start 使用显式兼容类型追加 collaborationMode", () => {
    const params: TurnStartParams = {
      threadId: "thread-1",
      input: [{ type: "text", text: "请先制定计划", text_elements: [] }],
      cwd: "/tmp/project",
      model: "gpt-5.5",
      approvalPolicy: "on-request",
    };

    const result = withPlanCollaborationMode(params, "plan", "gpt-5.5");

    expect(result).toMatchObject({
      threadId: "thread-1",
      collaborationMode: {
        mode: "plan",
        settings: {
          model: "gpt-5.5",
          reasoning_effort: null,
          developer_instructions: null,
        },
      },
    });
  });

  it("turn/start 从 Plan 退出时显式发送 default collaborationMode", () => {
    const params: TurnStartParams = {
      threadId: "thread-1",
      input: [{ type: "text", text: "Implement the plan.", text_elements: [] }],
      cwd: "/tmp/project",
      model: "gpt-5.5",
      approvalPolicy: "on-request",
    };

    expect(withTurnCollaborationMode(params, "code", "gpt-5.5")).toMatchObject({
      collaborationMode: {
        mode: "default",
        settings: {
          model: "gpt-5.5",
          reasoning_effort: null,
          developer_instructions: null,
        },
      },
    });
  });
});
