import { describe, expect, it } from "vitest";

import type { JsonRpcMessage } from "../../src/codex/protocol/json-rpc";
import { notificationFromAppServerMessage } from "../push-app-server-events";

describe("Codex push event filter", () => {
  it("notifies once for a completed turn and includes the final response", () => {
    const message: JsonRpcMessage = {
      method: "turn/completed",
      params: {
        threadId: "thread-1",
        turn: {
          id: "turn-1",
          status: "completed",
          items: [
            { id: "item-1", type: "agentMessage", text: "Earlier commentary" },
            { id: "item-2", type: "agentMessage", text: "Implemented the change." },
          ],
        },
      },
    };

    const notification = notificationFromAppServerMessage(message, {
      threadName: "Fix login",
      now: 1_700_000_000_000,
    });

    expect(notification).toMatchObject({
      dedupeKey: "turn:thread-1:turn-1:completed",
      payload: {
        version: 1,
        kind: "turn_completed",
        title: "Fix login finished",
        body: "Implemented the change.",
        threadId: "thread-1",
        turnId: "turn-1",
        source: "app-server.turn/completed",
      },
    });
  });

  it("notifies for failed turns but ignores in-progress, interrupted, and streaming messages", () => {
    const failed: JsonRpcMessage = {
      method: "turn/completed",
      params: {
        threadId: "thread-1",
        turn: { id: "turn-2", status: "failed", error: { message: "Sandbox denied access" } },
      },
    };
    expect(notificationFromAppServerMessage(failed)?.payload).toMatchObject({
      kind: "turn_failed",
      body: "Sandbox denied access",
    });
    expect(notificationFromAppServerMessage({
      method: "turn/completed",
      params: { threadId: "thread-1", turn: { id: "turn-3", status: "interrupted" } },
    })).toBeNull();
    expect(notificationFromAppServerMessage({
      method: "item/agentMessage/delta",
      params: { threadId: "thread-1", delta: "streamed text" },
    })).toBeNull();
    expect(notificationFromAppServerMessage({
      method: "thread/status/changed",
      params: { threadId: "thread-1", status: { type: "idle" } },
    })).toBeNull();
  });

  it("notifies only when a goal transitions to complete", () => {
    const message: JsonRpcMessage = {
      method: "thread/goal/updated",
      params: {
        threadId: "thread-1",
        goal: {
          threadId: "thread-1",
          objective: "Ship notifications",
          status: "complete",
          updatedAt: 42,
        },
      },
    };
    expect(notificationFromAppServerMessage(message)).toMatchObject({
      dedupeKey: "goal:thread-1:complete",
      payload: { kind: "goal_completed", title: "Goal achieved" },
    });
    expect(notificationFromAppServerMessage(message, { previousGoalStatus: "complete" })).toBeNull();
    expect(notificationFromAppServerMessage({
      method: "thread/goal/updated",
      params: { threadId: "thread-1", goal: { objective: "Ship", status: "active" } },
    })).toBeNull();
  });

  it("notifies for approvals, user questions, and MCP elicitation requests", () => {
    expect(notificationFromAppServerMessage({
      id: "approval-1",
      method: "item/commandExecution/requestApproval",
      params: { threadId: "thread-1", turnId: "turn-1", command: "npm publish" },
    })).toMatchObject({
      dedupeKey: "request:item/commandExecution/requestApproval:approval-1",
      payload: { kind: "approval_required", body: "npm publish" },
    });

    expect(notificationFromAppServerMessage({
      id: "question-1",
      method: "item/tool/requestUserInput",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        questions: [{ question: "Which environment?", header: "Environment" }],
      },
    })).toMatchObject({
      payload: { kind: "question_required", body: "Which environment?" },
    });

    expect(notificationFromAppServerMessage({
      id: "mcp-1",
      method: "mcpServer/elicitation/request",
      params: { threadId: "thread-1", message: "Enter the API base URL" },
    })).toMatchObject({
      payload: { kind: "question_required", body: "Enter the API base URL" },
    });

    expect(notificationFromAppServerMessage({
      id: "other-1",
      method: "item/tool/call",
      params: { threadId: "thread-1" },
    })).toBeNull();
  });
});
