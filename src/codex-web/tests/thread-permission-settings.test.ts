import { describe, expect, it } from "vitest";

import type { ConfigReadResponse } from "@/codex/protocol/generated/v2/ConfigReadResponse";
import {
  permissionProfileFromRuntimeSettings,
  resolveNewChatPermissionDefault,
} from "../thread-permission-settings";

function config(values: Record<string, unknown>): ConfigReadResponse {
  return { config: values as ConfigReadResponse["config"], origins: {}, layers: null };
}

describe("permissionProfileFromRuntimeSettings", () => {
  it("映射 app-server 的三种内置权限设置", () => {
    expect(permissionProfileFromRuntimeSettings({
      activePermissionProfile: { id: ":workspace", extends: null },
      approvalsReviewer: "user",
    })).toBe("request_approval");
    expect(permissionProfileFromRuntimeSettings({
      activePermissionProfile: { id: ":workspace", extends: null },
      approvalsReviewer: "auto_review",
    })).toBe("auto_approval");
    expect(permissionProfileFromRuntimeSettings({
      activePermissionProfile: { id: ":danger-full-access", extends: null },
    })).toBe("full_access");
  });

  it("保留自定义配置来源并兼容旧 sandbox 响应", () => {
    expect(permissionProfileFromRuntimeSettings({
      activePermissionProfile: { id: "team-profile", extends: ":workspace" },
    })).toBe("config");
    expect(permissionProfileFromRuntimeSettings({ sandbox: "danger-full-access" })).toBe("full_access");
    expect(permissionProfileFromRuntimeSettings({ sandbox: "read-only" })).toBe("config");
  });
});

describe("resolveNewChatPermissionDefault", () => {
  it("使用 config/read 的有效权限设置", () => {
    expect(resolveNewChatPermissionDefault(config({
      default_permissions: ":workspace",
      approvals_reviewer: "auto_review",
    }))).toBe("auto_approval");
    expect(resolveNewChatPermissionDefault(config({
      default_permissions: ":danger-full-access",
    }))).toBe("full_access");
    expect(resolveNewChatPermissionDefault(config({
      default_permissions: "team-profile",
    }))).toBe("config");
  });

  it("无显式配置时使用 Codex 工作区请求批准默认值", () => {
    expect(resolveNewChatPermissionDefault(config({}))).toBe("request_approval");
    expect(resolveNewChatPermissionDefault(null)).toBe("request_approval");
  });
});
