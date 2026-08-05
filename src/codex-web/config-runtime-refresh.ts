import type { ConfigEdit } from "@/codex/protocol/generated/v2/ConfigEdit";
import type { ConfigReadResponse } from "@/codex/protocol/generated/v2/ConfigReadResponse";

export type ConfigRuntimeRefreshPlan = {
  reloadUserConfig: boolean;
  reloadMcpServers: boolean;
  refreshMcp: boolean;
  refreshPlugins: boolean;
  refreshSkills: boolean;
};

type ConfigRuntimeRequest = (method: string, params?: unknown) => Promise<unknown>;

export type ConfigRuntimeRefreshResult = {
  config: ConfigReadResponse;
  plan: ConfigRuntimeRefreshPlan;
};

const UI_DEFAULT_ROOTS = new Set([
  "approval_policy",
  "approvals_reviewer",
  "default_permissions",
  "model",
  "model_reasoning_effort",
  "personality",
  "sandbox_mode",
  "sandbox_workspace_write",
  "service_tier",
]);

export function configRuntimeRefreshPlan(
  edits: readonly Pick<ConfigEdit, "keyPath">[],
): ConfigRuntimeRefreshPlan {
  const plan: ConfigRuntimeRefreshPlan = {
    reloadUserConfig: false,
    reloadMcpServers: false,
    refreshMcp: false,
    refreshPlugins: false,
    refreshSkills: false,
  };

  for (const { keyPath } of edits) {
    const root = keyPath.split(".", 1)[0] ?? "";
    if (UI_DEFAULT_ROOTS.has(root)) continue;

    if (root === "mcp_servers" || root.startsWith("mcp_")) {
      plan.reloadMcpServers = true;
      plan.refreshMcp = true;
      continue;
    }

    if (
      root === "plugins"
      || root === "plugin_marketplaces"
      || root === "marketplaces"
      || keyPath.startsWith("features.plugins")
      || keyPath.startsWith("features.remote_plugin")
    ) {
      plan.reloadUserConfig = true;
      plan.reloadMcpServers = true;
      plan.refreshMcp = true;
      plan.refreshPlugins = true;
      plan.refreshSkills = true;
      continue;
    }

    if (root === "skills") {
      plan.reloadUserConfig = true;
      plan.refreshSkills = true;
      continue;
    }

    if (root === "hooks" || root === "notify" || root === "memories" || root === "apps") {
      plan.reloadUserConfig = true;
      continue;
    }

    plan.reloadUserConfig = true;
    plan.refreshMcp = true;
    plan.refreshPlugins = true;
    plan.refreshSkills = true;
  }

  return plan;
}

export async function applyConfigRuntimeEdits(
  request: ConfigRuntimeRequest,
  edits: ConfigEdit[],
): Promise<ConfigRuntimeRefreshResult> {
  const plan = configRuntimeRefreshPlan(edits);
  await request("config/batchWrite", {
    edits,
    reloadUserConfig: plan.reloadUserConfig,
  });
  if (plan.reloadMcpServers) {
    await request("config/mcpServer/reload");
  }
  const config = await request("config/read", {
    includeLayers: false,
    cwd: null,
  }) as ConfigReadResponse;
  return { config, plan };
}
