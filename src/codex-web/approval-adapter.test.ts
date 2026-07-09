import { describe, expect, it } from "vitest";

import { buildApprovalResponse, mapServerRequestToApproval } from "./approval-adapter";

describe("approval-adapter", () => {
  it("把 command approval 映射到官方 app-server response", () => {
    const approval = mapServerRequestToApproval({
      id: "req-1",
      method: "item/commandExecution/requestApproval",
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
    });

    expect(approval?.permission).toMatchObject({
      permissionRequestId: "req-1",
      toolName: "Bash",
      toolUseId: "cmd-1",
      toolInput: expect.objectContaining({ command: "npm test", cwd: "/repo" }),
    });
    expect(approval && buildApprovalResponse(approval, "allow")).toEqual({ decision: "accept" });
    expect(approval && buildApprovalResponse(approval, "allow_session")).toEqual({
      decision: "acceptForSession",
    });
    expect(approval && buildApprovalResponse(approval, "deny")).toEqual({ decision: "decline" });
  });

  it("把 fileChange approval 映射到官方 app-server response", () => {
    const approval = mapServerRequestToApproval({
      id: 7,
      method: "item/fileChange/requestApproval",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        itemId: "patch-1",
        startedAtMs: 1,
        reason: "需要写入文件",
        grantRoot: "/repo",
      },
    });

    expect(approval?.permission).toMatchObject({
      permissionRequestId: "7",
      toolName: "Patch",
      blockedPath: "/repo",
    });
    expect(approval && buildApprovalResponse(approval, "allow_session")).toEqual({
      decision: "acceptForSession",
    });
  });

  it("把 permissions approval 映射为授权权限响应", () => {
    const approval = mapServerRequestToApproval({
      id: "perm-1",
      method: "item/permissions/requestApproval",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        itemId: "perm-1",
        environmentId: null,
        startedAtMs: 1,
        cwd: "/repo",
        reason: "需要网络",
        permissions: {
          network: { enabled: true },
          fileSystem: null,
        },
      },
    });

    expect(approval?.permission).toMatchObject({
      toolName: "Permissions",
      toolInput: {
        cwd: "/repo",
        environmentId: null,
        permissions: {
          network: { enabled: true },
          fileSystem: null,
        },
      },
    });
    expect(approval && buildApprovalResponse(approval, "allow")).toEqual({
      permissions: { network: { enabled: true } },
      scope: "turn",
    });
    expect(approval && buildApprovalResponse(approval, "allow_session")).toEqual({
      permissions: { network: { enabled: true } },
      scope: "session",
    });
    expect(approval && buildApprovalResponse(approval, "deny")).toEqual({
      permissions: {},
      scope: "turn",
    });
  });

  it("忽略非 approval server request", () => {
    expect(mapServerRequestToApproval({ id: "x", method: "item/tool/requestUserInput" })).toBeNull();
  });
});
