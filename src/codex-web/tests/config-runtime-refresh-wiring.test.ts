import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const provider = readFileSync(
  resolve(process.cwd(), "src/codex-web/AppServerProvider.tsx"),
  "utf8",
);

describe("配置运行时选择性热加载接线", () => {
  it("所有产品配置写入统一经过 config/batchWrite 和分类计划", () => {
    expect(provider).toContain("applyConfigRuntimeEdits(");
    expect(provider).toContain("writeConfigEdits: (edits: ConfigEdit[]) => Promise<ConfigReadResponse>");
    expect(provider).not.toContain('client.request("config/value/write"');
  });

  it("仅分类命中时 reload MCP 并递增对应修订号", () => {
    expect(provider).toContain("mcpRevision: current.mcpRevision + Number(plan.refreshMcp)");
    expect(provider).toContain("pluginsRevision: current.pluginsRevision + Number(plan.refreshPlugins)");
    expect(provider).toContain("skillsRevision: current.skillsRevision + Number(plan.refreshSkills)");
  });

  it("MCP 和 Memory 写入复用统一入口", () => {
    expect(provider).toContain("return writeConfigEdits([\n      { keyPath: \"mcp_servers\"");
    expect(provider).toContain("await writeConfigEdits([\n      { keyPath: \"memories.use_memories\"");
  });
});
