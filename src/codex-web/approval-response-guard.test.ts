import { describe, expect, it } from "vitest";

import type { AppServerApprovalRequest } from "./approval-adapter";
import {
  approvalRequestKey,
  beginApprovalResponse,
  completeApprovalResponse,
  failApprovalResponse,
} from "./approval-response-guard";

describe("approval-response-guard", () => {
  it("允许当前 pending approval 开始响应，并标记为 responding", () => {
    const result = beginApprovalResponse({
      pendingApproval: approval("req-1"),
      requestId: "req-1",
      state: {},
    });

    expect(result).toMatchObject({
      ok: true,
      key: "string:req-1",
      state: { "string:req-1": "responding" },
    });
  });

  it("没有 pending approval 时快速失败", () => {
    const result = beginApprovalResponse({
      pendingApproval: null,
      requestId: "req-1",
      state: {},
    });

    expect(result).toMatchObject({
      ok: false,
      reason: "missing",
      key: "string:req-1",
    });
  });

  it("拒绝 stale requestId", () => {
    const result = beginApprovalResponse({
      pendingApproval: approval("current"),
      requestId: "old",
      state: {},
    });

    expect(result).toMatchObject({
      ok: false,
      reason: "stale",
      key: "string:old",
    });
  });

  it("拒绝重复响应同一个 requestId", () => {
    const key = approvalRequestKey("req-1");
    const result = beginApprovalResponse({
      pendingApproval: approval("req-1"),
      requestId: "req-1",
      state: { [key]: "responding" },
    });

    expect(result).toMatchObject({
      ok: false,
      reason: "duplicate",
      key,
    });
  });

  it("完成后标记 resolved，失败后允许重试", () => {
    const key = approvalRequestKey(7);
    const resolved = completeApprovalResponse({
      key,
      state: { [key]: "responding" },
    });
    expect(resolved).toEqual({ [key]: "resolved" });

    const retryable = failApprovalResponse({
      key,
      state: { [key]: "responding" },
    });
    expect(retryable).toEqual({});
  });
});

function approval(requestId: string | number): AppServerApprovalRequest {
  return {
    requestId,
    method: "item/commandExecution/requestApproval",
    threadId: "thread-1",
    turnId: "turn-1",
    itemId: "cmd-1",
    params: {
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "cmd-1",
      startedAtMs: 1,
      environmentId: null,
      command: "npm test",
      cwd: "/repo",
      commandActions: null,
    },
    permission: {
      permissionRequestId: String(requestId),
      toolName: "Bash",
      toolUseId: "cmd-1",
      toolInput: { command: "npm test" },
    },
  };
}
