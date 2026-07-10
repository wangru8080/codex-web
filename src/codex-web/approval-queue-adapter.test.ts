import { describe, expect, it } from "vitest";

import type { AppServerApprovalRequest } from "./approval-adapter";
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
});

function approval(requestId: string | number, threadId: string): AppServerApprovalRequest {
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
