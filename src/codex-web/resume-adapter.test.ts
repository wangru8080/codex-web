import { describe, expect, it } from "vitest";

import { buildThreadResumeParams } from "./resume-adapter";

describe("buildThreadResumeParams", () => {
  it("按官方方式只用 threadId 恢复历史，不拼接或传入 history", () => {
    const params = buildThreadResumeParams({
      threadId: "thread-1",
      cwd: "/repo/web",
      model: "gpt-5.5",
    });

    expect(params).toEqual({
      threadId: "thread-1",
      cwd: "/repo/web",
      model: "gpt-5.5",
      approvalPolicy: "on-request",
    });
    expect("history" in params).toBe(false);
  });
});
