import { describe, expect, it } from "vitest";

import {
  mcpServersFromConfig,
  mcpServersToConfigValue,
} from "./mcp-config-adapter";

describe("MCP config adapter", () => {
  it("从 config/read 提取 stdio 与 streamable HTTP 配置", () => {
    expect(mcpServersFromConfig({
      config: {
        mcp_servers: {
          local: { command: "server", args: ["--stdio"], enabled: false, environment_id: "local", tool_timeout_sec: null },
          docs: { url: "https://example.com/mcp", http_headers: { "X-Test": "1" } },
        },
      },
      origins: {},
      layers: null,
    } as never)).toEqual({
      local: { command: "server", args: ["--stdio"], enabled: false, type: "stdio" },
      docs: { url: "https://example.com/mcp", headers: { "X-Test": "1" }, type: "http" },
    });
  });

  it("写回时移除 UI type 并恢复 http_headers", () => {
    expect(mcpServersToConfigValue({
      local: { type: "stdio", command: "server", args: ["--stdio"], enabled: true },
      docs: { type: "http", url: "https://example.com/mcp", headers: { Authorization: "Bearer x" } },
    })).toEqual({
      local: { command: "server", args: ["--stdio"], enabled: true },
      docs: { url: "https://example.com/mcp", http_headers: { Authorization: "Bearer x" } },
    });
  });

  it("不把 config/read 的派生字段和 null 写回 config.toml", () => {
    expect(mcpServersToConfigValue({
      local: {
        command: "server",
        type: "stdio",
        environment_id: "local",
        tool_timeout_sec: null,
      } as never,
    })).toEqual({ local: { command: "server" } });
  });
});
