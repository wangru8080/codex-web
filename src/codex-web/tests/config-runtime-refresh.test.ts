import { describe, expect, it } from "vitest";

import type { ConfigEdit } from "@/codex/protocol/generated/v2/ConfigEdit";
import { applyConfigRuntimeEdits, configRuntimeRefreshPlan } from "../config-runtime-refresh";

function edit(keyPath: string): ConfigEdit {
  return { keyPath, value: true, mergeStrategy: "replace" };
}

describe("configRuntimeRefreshPlan", () => {
  it("默认模型和权限只刷新 config/read", () => {
    expect(configRuntimeRefreshPlan([
      edit("model"),
      edit("model_reasoning_effort"),
      edit("approval_policy"),
      edit("sandbox_mode"),
    ])).toEqual({
      reloadUserConfig: false,
      reloadMcpServers: false,
      refreshMcp: false,
      refreshPlugins: false,
      refreshSkills: false,
    });
  });

  it("MCP 只执行专用 reload 并刷新 MCP 页面", () => {
    expect(configRuntimeRefreshPlan([edit("mcp_servers.github")])).toEqual({
      reloadUserConfig: false,
      reloadMcpServers: true,
      refreshMcp: true,
      refreshPlugins: false,
      refreshSkills: false,
    });
  });

  it("Plugin 变更刷新其派生的 MCP、Skills 和 Plugin 数据", () => {
    expect(configRuntimeRefreshPlan([edit("plugins.entries.demo.enabled")])).toEqual({
      reloadUserConfig: true,
      reloadMcpServers: true,
      refreshMcp: true,
      refreshPlugins: true,
      refreshSkills: true,
    });
  });

  it("Skills、Hooks 和 Memory 只热加载用户配置层", () => {
    expect(configRuntimeRefreshPlan([
      edit("skills.config.demo.enabled"),
      edit("hooks.state.demo.enabled"),
      edit("memories.use_memories"),
    ])).toEqual({
      reloadUserConfig: true,
      reloadMcpServers: false,
      refreshMcp: false,
      refreshPlugins: false,
      refreshSkills: true,
    });
  });

  it("未知键保守热加载运行时并刷新扩展目录", () => {
    expect(configRuntimeRefreshPlan([edit("future_runtime.enabled")])).toEqual({
      reloadUserConfig: true,
      reloadMcpServers: false,
      refreshMcp: true,
      refreshPlugins: true,
      refreshSkills: true,
    });
  });
});

describe("applyConfigRuntimeEdits", () => {
  it("默认值写入不触发运行时或 MCP reload", async () => {
    const calls: Array<[string, unknown]> = [];
    const config = { config: { model: "gpt-5.6-sol" }, origins: {} };
    const result = await applyConfigRuntimeEdits(async (method, params) => {
      calls.push([method, params]);
      return method === "config/read" ? config : {};
    }, [edit("model")]);

    expect(calls).toEqual([
      ["config/batchWrite", {
        edits: [edit("model")],
        reloadUserConfig: false,
      }],
      ["config/read", { includeLayers: false, cwd: null }],
    ]);
    expect(result.config).toBe(config);
  });

  it("MCP 写入在重新读取配置前执行专用 reload", async () => {
    const methods: string[] = [];
    await applyConfigRuntimeEdits(async (method) => {
      methods.push(method);
      return method === "config/read" ? { config: {}, origins: {} } : {};
    }, [edit("mcp_servers.github")]);

    expect(methods).toEqual([
      "config/batchWrite",
      "config/mcpServer/reload",
      "config/read",
    ]);
  });

  it("运行时配置通过 batchWrite 的 reloadUserConfig 热加载", async () => {
    const calls: Array<[string, unknown]> = [];
    await applyConfigRuntimeEdits(async (method, params) => {
      calls.push([method, params]);
      return method === "config/read" ? { config: {}, origins: {} } : {};
    }, [edit("memories.use_memories")]);

    expect(calls[0]).toEqual(["config/batchWrite", {
      edits: [edit("memories.use_memories")],
      reloadUserConfig: true,
    }]);
    expect(calls.map(([method]) => method)).not.toContain("config/mcpServer/reload");
  });
});
