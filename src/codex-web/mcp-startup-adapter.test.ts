import { describe, expect, it } from "vitest";

import { reduceMcpStartupNotification } from "./mcp-startup-adapter";

describe("MCP startup notification", () => {
  it("保存服务器启动状态、错误和事实来源", () => {
    expect(reduceMcpStartupNotification({}, {
      method: "mcpServer/startupStatus/updated",
      params: {
        threadId: null,
        name: "docs",
        status: "failed",
        error: "connection refused",
        failureReason: null,
      },
    })).toEqual({
      docs: {
        source: "app-server.mcpServer/startupStatus/updated",
        data: {
          threadId: null,
          name: "docs",
          status: "failed",
          error: "connection refused",
          failureReason: null,
        },
      },
    });
  });

  it("忽略无关或非法 notification", () => {
    const current = {};
    expect(reduceMcpStartupNotification(current, { method: "skills/changed", params: {} })).toBe(current);
    expect(reduceMcpStartupNotification(current, {
      method: "mcpServer/startupStatus/updated",
      params: { name: "", status: "ready" },
    })).toBe(current);
  });
});
