import { describe, expect, it } from "vitest";

import {
  planCollaborationModeForRequest,
  withPlanCollaborationMode,
} from "./app-server-collaboration-mode";

describe("app-server collaboration mode params", () => {
  it("Plan mode 生成 app-server collaborationMode", () => {
    expect(planCollaborationModeForRequest("plan", "gpt-5.5")).toEqual({
      mode: "plan",
      settings: {
        model: "gpt-5.5",
        reasoning_effort: null,
        developer_instructions: null,
      },
    });
  });

  it("Default/code mode 不传 collaborationMode", () => {
    expect(planCollaborationModeForRequest("code", "gpt-5.5")).toBeNull();
    expect(planCollaborationModeForRequest(undefined, "gpt-5.5")).toBeNull();
  });

  it("只在 Plan mode 给请求参数追加 collaborationMode", () => {
    expect(withPlanCollaborationMode({ model: "gpt-5.5" }, "code", "gpt-5.5")).toEqual({
      model: "gpt-5.5",
    });
    expect(withPlanCollaborationMode({ model: "gpt-5.5" }, "plan", "gpt-5.5")).toEqual({
      model: "gpt-5.5",
      collaborationMode: {
        mode: "plan",
        settings: {
          model: "gpt-5.5",
          reasoning_effort: null,
          developer_instructions: null,
        },
      },
    });
  });
});
