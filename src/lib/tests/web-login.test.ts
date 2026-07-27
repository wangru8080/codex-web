import { describe, expect, it } from "vitest";

import { canSubmitLogin, resolveLoginDestination } from "../web-login";

describe("登录页纯逻辑", () => {
  it("只接受站内 next 路径", () => {
    expect(resolveLoginDestination("/settings/security?tab=turnstile")).toBe("/settings/security?tab=turnstile");
    expect(resolveLoginDestination("https://example.com")).toBe("/chat");
    expect(resolveLoginDestination("//example.com")).toBe("/chat");
    expect(resolveLoginDestination(null)).toBe("/chat");
  });

  it("Turnstile 启用时必须先获得 token", () => {
    expect(canSubmitLogin(false, false, "")).toBe(false);
    expect(canSubmitLogin(true, false, "")).toBe(true);
    expect(canSubmitLogin(true, true, "")).toBe(false);
    expect(canSubmitLogin(true, true, "token")).toBe(true);
  });
});
