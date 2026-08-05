import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("插件目录 app-server actions", () => {
  it("Provider 使用官方 Skills 与 MCP 方法", () => {
    const provider = readFileSync(resolve(process.cwd(), "src/codex-web/AppServerProvider.tsx"), "utf8");
    const configRuntime = readFileSync(resolve(process.cwd(), "src/codex-web/config-runtime-refresh.ts"), "utf8");

    expect(provider).toContain('client.request("skills/list"');
    expect(provider).toContain('client.request("skills/config/write"');
    expect(configRuntime).toContain('request("config/batchWrite"');
    expect(provider).toContain('client.request("config/mcpServer/reload"');
    expect(provider).toContain('client.request("mcpServerStatus/list"');
    expect(provider).toContain('client.request("plugin/installed"');
    expect(provider).toContain('client.request("plugin/read"');
  });
});
