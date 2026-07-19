import { describe, expect, it } from "vitest";

import type { AppServerPendingRequest } from "./approval-adapter";
import {
  approvalRequestMatchesThread,
  enqueueApproval,
  findApprovalByRequestId,
  firstApproval,
  removeApproval,
} from "./approval-queue-adapter";

describe("approval-queue-adapter", () => {
  it("按顺序入队并保留队首", () => {
    const queue = enqueueApproval(enqueueApproval([], approval("req-1", "thread-a")), approval("req-2", "thread-b"));

    expect(queue.map((item) => item.requestId)).toEqual(["req-1", "req-2"]);
    expect(firstApproval(queue)?.requestId).toBe("req-1");
  });

  it("重复 requestId 不重复入队", () => {
    const first = approval("req-1", "thread-a");
    const duplicate = approval("req-1", "thread-b");

    const queue = enqueueApproval(enqueueApproval([], first), duplicate);

    expect(queue).toEqual([first]);
  });

  it("按 requestId 移除 resolved approval 并推进队首", () => {
    const queue = [approval("req-1", "thread-a"), approval("req-2", "thread-b")];

    const next = removeApproval(queue, "req-1");

    expect(next.map((item) => item.requestId)).toEqual(["req-2"]);
    expect(firstApproval(next)?.requestId).toBe("req-2");
  });

  it("按 requestId 查找并区分数字和字符串", () => {
    const queue = [approval(7, "thread-a"), approval("7", "thread-b")];

    expect(findApprovalByRequestId(queue, 7)?.threadId).toBe("thread-a");
    expect(findApprovalByRequestId(queue, "7")?.threadId).toBe("thread-b");
  });

  it("支持按当前 thread 过滤可见 approval", () => {
    const queue = [approval("other", "thread-other"), approval("current", "thread-current")];

    const visible = firstApproval(queue, (item) =>
      approvalRequestMatchesThread(item, ["thread-current", null]),
    );

    expect(visible?.requestId).toBe("current");
  });

  it("多个 pending approval 并发时只暴露当前 thread 的 requestId", () => {
    const queue = [
      approval("req-a", "thread-a"),
      approval("req-b", "thread-b"),
      approval("req-c", "thread-c"),
    ];

    const visibleForB = firstApproval(queue, (item) =>
      approvalRequestMatchesThread(item, ["thread-b"]),
    );
    const visibleForA = firstApproval(queue, (item) =>
      approvalRequestMatchesThread(item, ["thread-a"]),
    );

    expect(visibleForB?.requestId).toBe("req-b");
    expect(visibleForA?.requestId).toBe("req-a");
    expect(approvalRequestMatchesThread(queue[1], ["thread-a"])).toBe(false);
  });

  it("用户输入和 MCP elicitation 与 approval 共用 FIFO", () => {
    const input: AppServerPendingRequest = {
      requestId: "input-1",
      method: "item/tool/requestUserInput",
      threadId: "thread-a",
      turnId: "turn-1",
      itemId: "tool-1",
      params: {
        threadId: "thread-a",
        turnId: "turn-1",
        itemId: "tool-1",
        questions: [],
        autoResolutionMs: null,
      },
    };
    const elicitation: AppServerPendingRequest = {
      requestId: "mcp-1",
      method: "mcpServer/elicitation/request",
      threadId: "thread-b",
      turnId: null,
      serverName: "demo",
      params: {
        threadId: "thread-b",
        turnId: null,
        serverName: "demo",
        mode: "url",
        message: "登录",
        url: "https://example.com/login",
        elicitationId: "login-1",
        _meta: null,
      },
    };

    const queue = enqueueApproval(enqueueApproval([], input), elicitation);

    expect(queue.map((item) => item.requestId)).toEqual(["input-1", "mcp-1"]);
    expect(firstApproval(queue, (item) => approvalRequestMatchesThread(item, ["thread-b"]))?.requestId).toBe("mcp-1");
  });
});

function approval(requestId: string | number, threadId: string): AppServerPendingRequest {
  return {
    requestId,
    method: "item/commandExecution/requestApproval",
    threadId,
    turnId: "turn-1",
    itemId: "cmd-1",
    params: {
      threadId,
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
