import { describe, expect, it } from "vitest";

import type { ConfigReadResponse } from "@/codex/protocol/generated/v2/ConfigReadResponse";
import {
  defaultPermissionModeConfigEdits,
  defaultPermissionModeFromConfig,
} from "../default-permission-mode";

function config(values: Record<string, unknown>): ConfigReadResponse {
  return { config: values as ConfigReadResponse["config"], origins: {}, layers: null };
}

describe("defaultPermissionModeConfigEdits", () => {
  it("请求批准写入完整的工作区模式", () => {
    expect(defaultPermissionModeConfigEdits("request_approval")).toEqual([
      { keyPath: "default_permissions", value: ":workspace", mergeStrategy: "replace" },
      { keyPath: "approvals_reviewer", value: "user", mergeStrategy: "replace" },
      { keyPath: "approval_policy", value: "on-request", mergeStrategy: "replace" },
      { keyPath: "sandbox_mode", value: "workspace-write", mergeStrategy: "replace" },
    ]);
  });

  it("替我审批只改变审批审阅者，不混入完全访问", () => {
    expect(defaultPermissionModeConfigEdits("auto_approval")).toEqual([
      { keyPath: "default_permissions", value: ":workspace", mergeStrategy: "replace" },
      { keyPath: "approvals_reviewer", value: "auto_review", mergeStrategy: "replace" },
      { keyPath: "approval_policy", value: "on-request", mergeStrategy: "replace" },
      { keyPath: "sandbox_mode", value: "workspace-write", mergeStrategy: "replace" },
    ]);
  });

  it("完全访问同时写入四项 app-server 权限设置", () => {
    expect(defaultPermissionModeConfigEdits("full_access")).toEqual([
      { keyPath: "default_permissions", value: ":danger-full-access", mergeStrategy: "replace" },
      { keyPath: "approvals_reviewer", value: "user", mergeStrategy: "replace" },
      { keyPath: "approval_policy", value: "never", mergeStrategy: "replace" },
      { keyPath: "sandbox_mode", value: "danger-full-access", mergeStrategy: "replace" },
    ]);
  });
});

describe("defaultPermissionModeFromConfig", () => {
  it("设置页从 config/read 解析当前默认权限", () => {
    expect(defaultPermissionModeFromConfig(config({
      default_permissions: ":danger-full-access",
      approval_policy: "never",
      sandbox_mode: "danger-full-access",
    }))).toBe("full_access");
    expect(defaultPermissionModeFromConfig(config({
      default_permissions: ":workspace",
      approvals_reviewer: "auto_review",
      approval_policy: "on-request",
      sandbox_mode: "workspace-write",
    }))).toBe("auto_approval");
    expect(defaultPermissionModeFromConfig(config({
      default_permissions: ":workspace",
      approvals_reviewer: "user",
      approval_policy: "on-request",
      sandbox_mode: "workspace-write",
    }))).toBe("request_approval");
  });

  it("保留 config.toml 中无法映射为内置模式的自定义权限", () => {
    expect(defaultPermissionModeFromConfig(config({
      default_permissions: "team-profile",
    }))).toBe("config");
  });
});
