import { describe, expect, it } from "vitest";

import type { ConfigReadResponse } from "@/codex/protocol/generated/v2/ConfigReadResponse";

import { threadRuntimeOptions, turnRuntimeOptions } from "./app-server-runtime-options";

describe("app-server-runtime-options", () => {
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
