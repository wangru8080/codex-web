import { describe, expect, it } from "vitest";

import {
  buildApprovalResponse,
  buildServerRequestResponse,
  mapServerRequestToApproval,
  mapServerRequestToPendingRequest,
} from "../approval-adapter";

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

  it("把 requestUserInput 映射为用户输入请求并按 question id 响应", () => {
    const request = mapServerRequestToPendingRequest({
      id: "input-1",
      method: "item/tool/requestUserInput",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        itemId: "tool-1",
        autoResolutionMs: 60_000,
        questions: [
          {
            id: "environment",
            header: "环境",
            question: "选择环境",
            isOther: true,
            isSecret: false,
            options: [{ label: "生产", description: "线上环境" }],
          },
        ],
      },
    });

    expect(request).toMatchObject({
      method: "item/tool/requestUserInput",
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "tool-1",
    });
    expect(request && buildServerRequestResponse(request, {
      type: "userInput",
      answers: { environment: { answers: ["生产"] } },
    })).toEqual({
      answers: { environment: { answers: ["生产"] } },
    });
  });

  it("把 MCP elicitation 映射为独立请求并生成精确 action/content/meta", () => {
    const request = mapServerRequestToPendingRequest({
      id: "mcp-1",
      method: "mcpServer/elicitation/request",
      params: {
        threadId: "thread-1",
        turnId: null,
        serverName: "payments",
        mode: "form",
        message: "需要付款信息",
        _meta: { source: "checkout" },
        requestedSchema: {
          type: "object",
          properties: { email: { type: "string", format: "email" } },
          required: ["email"],
        },
      },
    });

    expect(request).toMatchObject({
      method: "mcpServer/elicitation/request",
      threadId: "thread-1",
      turnId: null,
      serverName: "payments",
    });
    expect(request && buildServerRequestResponse(request, {
      type: "elicitation",
      action: "accept",
      content: { email: "user@example.com" },
      _meta: { source: "checkout" },
    })).toEqual({
      action: "accept",
      content: { email: "user@example.com" },
      _meta: { source: "checkout" },
    });
    expect(request && buildServerRequestResponse(request, {
      type: "elicitation",
      action: "decline",
    })).toEqual({ action: "decline", content: null, _meta: null });
    expect(request && buildServerRequestResponse(request, {
      type: "elicitation",
      action: "cancel",
      content: { ignored: true },
    })).toEqual({ action: "cancel", content: null, _meta: null });
  });

  it("拒绝把错误种类的响应发给 server request", () => {
    const request = mapServerRequestToPendingRequest({
      id: "input-1",
      method: "item/tool/requestUserInput",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        itemId: "tool-1",
        autoResolutionMs: null,
        questions: [],
      },
    });

    expect(() => request && buildServerRequestResponse(request, {
      type: "approval",
      decision: "allow",
    })).toThrow("响应类型与 app-server request 不匹配");
  });

  it("approval-only mapper 仍忽略用户输入 request，通用 mapper 忽略未知 request", () => {
    expect(mapServerRequestToApproval({ id: "x", method: "item/tool/requestUserInput" })).toBeNull();
    expect(mapServerRequestToPendingRequest({ id: "x", method: "unknown/request" })).toBeNull();
  });
});
