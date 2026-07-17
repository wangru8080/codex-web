import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("MCP manager app-server wiring", () => {
  it("配置、启停、reload 和状态不再请求失效 API", () => {
    const manager = readFileSync(resolve(process.cwd(), "src/components/plugins/McpManager.tsx"), "utf8");
    const list = readFileSync(resolve(process.cwd(), "src/components/plugins/McpServerList.tsx"), "utf8");
    const json = readFileSync(resolve(process.cwd(), "src/components/plugins/McpJsonConfigDialog.tsx"), "utf8");

    expect(manager).toContain("refreshConfig");
    expect(manager).toContain("writeMcpServers");
    expect(manager).toContain("listMcpServerStatus");
    expect(manager).toContain("reloadMcpServers");
    expect(manager).toContain('appServerState.connection.data !== "connected"');
    expect(manager).not.toContain("/api/plugins/mcp");
    expect(list).not.toContain("/api/plugins/mcp");
    expect(json).not.toContain('fetch("/api/plugins/mcp")');
  });
});
