import { describe, expect, it } from "vitest";

import { buildThreadResumeParams } from "./resume-adapter";

describe("buildThreadResumeParams", () => {
  it("按官方方式只用 threadId 恢复历史，不拼接或传入 history", () => {
    const params = buildThreadResumeParams({
      threadId: "thread-1",
      cwd: "/repo/web",
      model: "gpt-5.5",
      runtimeOptions: {
        approvalPolicy: "on-request",
        approvalsReviewer: "user",
        sandbox: "workspace-write",
        config: { web_search: "live" },
      },
    });

    expect(params).toEqual({
      threadId: "thread-1",
      cwd: "/repo/web",
      model: "gpt-5.5",
      approvalPolicy: "on-request",
      approvalsReviewer: "user",
      sandbox: "workspace-write",
      config: { web_search: "live" },
    });
    expect("history" in params).toBe(false);
  });
});
