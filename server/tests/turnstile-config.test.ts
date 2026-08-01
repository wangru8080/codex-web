import { describe, expect, it } from "vitest";

import {
  mergeTurnstileConfig,
  publicTurnstileConfig,
  turnstileConfigPath,
  type TurnstileConfig,
} from "../turnstile-config";

const configured: TurnstileConfig = {
  enabled: true,
  siteKey: "site-key",
  secretKey: "secret-key",
};

describe("Turnstile 配置", () => {
  it("优先使用独立的 Web 状态目录", () => {
    expect(turnstileConfigPath({
      CODEX_WEB_STATE: "/srv/codex-web-state",
      CODEX_HOME: "/home/user/.codex",
    })).toBe("/srv/codex-web-state/codex-web/turnstile.json");
  });

  it("兼容未设置 Web 状态目录的单用户配置", () => {
    expect(turnstileConfigPath({ CODEX_HOME: "/home/user/.codex" }))
      .toBe("/home/user/.codex/codex-web/turnstile.json");
  });

  it("公开配置永不包含私密密钥", () => {
    expect(publicTurnstileConfig(configured)).toEqual({
      enabled: true,
      siteKey: "site-key",
      secretKeyConfigured: true,
    });
  });

  it("空私密密钥保留当前值", () => {
    expect(
      mergeTurnstileConfig(configured, { enabled: false, siteKey: "new-site", secretKey: "" }),
    ).toEqual({ enabled: false, siteKey: "new-site", secretKey: "secret-key" });
  });

  it("启用时要求站点密钥和私密密钥", () => {
    expect(() =>
      mergeTurnstileConfig(
        { enabled: false, siteKey: "", secretKey: "" },
        { enabled: true, siteKey: "site", secretKey: "" },
      ),
    ).toThrow("私密密钥");
  });
});
