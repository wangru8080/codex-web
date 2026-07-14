import { describe, expect, it } from "vitest";

import type { ConfigReadResponse } from "@/codex/protocol/generated/v2/ConfigReadResponse";

import { threadPermissionUpdateOptions, threadRuntimeOptions, turnRuntimeOptions } from "./app-server-runtime-options";

describe("app-server-runtime-options", () => {
  it("按官方 TUI 语义构造当前线程权限更新", () => {
    expect(threadPermissionUpdateOptions("request_approval", "/repo")).toMatchObject({
      approvalPolicy: "on-request",
      approvalsReviewer: "user",
      permissions: ":workspace",
    });
    expect(threadPermissionUpdateOptions("auto_approval", "/repo")).toMatchObject({
      approvalPolicy: "on-request",
      approvalsReviewer: "auto_review",
      permissions: ":workspace",
    });
    expect(threadPermissionUpdateOptions("full_access", "/repo")).toMatchObject({
      approvalPolicy: "never",
      approvalsReviewer: "user",
      permissions: ":danger-full-access",
    });
    expect(threadPermissionUpdateOptions("config", "/repo", "custom")).toEqual({ permissions: "custom" });
    expect(threadPermissionUpdateOptions("config", "/repo", null, config("live"))).toEqual({
      approvalPolicy: "on-request",
      approvalsReviewer: "user",
      sandboxPolicy: {
        type: "workspaceWrite",
        writableRoots: [],
        networkAccess: false,
        excludeTmpdirEnvVar: false,
        excludeSlashTmp: false,
      },
    });
    const configured = config("live");
    configured.config.approval_policy = "on-request";
    configured.config.approvals_reviewer = "auto_review";
    configured.config.sandbox_mode = "workspace-write";
    configured.config.sandbox_workspace_write = {
      writable_roots: ["/repo"],
      network_access: false,
      exclude_tmpdir_env_var: false,
      exclude_slash_tmp: false,
    };
    expect(threadPermissionUpdateOptions("config", "/repo", null, configured)).toMatchObject({
      approvalPolicy: "on-request",
      approvalsReviewer: "auto_review",
      sandboxPolicy: { type: "workspaceWrite" },
    });
  });

  it("请求批准模式转发 web_search 并由用户审批", () => {
    expect(threadRuntimeOptions("request_approval", config("live"))).toEqual({
      approvalPolicy: "on-request",
      approvalsReviewer: "user",
      sandbox: "workspace-write",
      config: { web_search: "live" },
    });
    expect(turnRuntimeOptions("request_approval", "/repo")).toEqual({
      approvalPolicy: "on-request",
      approvalsReviewer: "user",
      sandboxPolicy: {
        type: "workspaceWrite",
        writableRoots: ["/repo"],
        networkAccess: false,
        excludeTmpdirEnvVar: false,
        excludeSlashTmp: false,
      },
    });
  });

  it("替我审批使用 app-server auto_review", () => {
    expect(threadRuntimeOptions("auto_approval", config("cached"))).toMatchObject({
      approvalPolicy: "on-request",
      approvalsReviewer: "auto_review",
      sandbox: "workspace-write",
    });
  });

  it("完全访问必须是显式 danger-full-access", () => {
    expect(threadRuntimeOptions("full_access", config("live"))).toMatchObject({
      approvalPolicy: "never",
      sandbox: "danger-full-access",
    });
    expect(turnRuntimeOptions("full_access", "/repo")).toMatchObject({
      approvalPolicy: "never",
      sandboxPolicy: { type: "dangerFullAccess" },
    });
  });

  it("config 模式不覆盖 sandbox 与 approval", () => {
    expect(threadRuntimeOptions("config", config("disabled"))).toEqual({
      config: { web_search: "disabled" },
    });
    expect(turnRuntimeOptions("config", "/repo")).toEqual({});
  });
});

function config(webSearch: "disabled" | "cached" | "indexed" | "live"): ConfigReadResponse {
  return {
    config: { web_search: webSearch } as ConfigReadResponse["config"],
    origins: {},
    layers: null,
  };
}
