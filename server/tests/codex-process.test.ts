import { describe, expect, it } from "vitest";

import { buildCodexProcessEnv } from "../codex-process";

describe("buildCodexProcessEnv", () => {
  it("显式 codexHome 优先于环境变量", () => {
    const env = buildCodexProcessEnv(
      {
        codexHome: "/chosen/codex-home",
        env: { NODE_ENV: "test", CODEX_HOME: "/option/env-home" },
      },
      { NODE_ENV: "test", CODEX_HOME: "/base/env-home" },
    );

    expect(env.CODEX_HOME).toBe("/chosen/codex-home");
  });

  it("未传 codexHome 时保留调用方选择的环境", () => {
    const env = buildCodexProcessEnv(
      { env: { NODE_ENV: "test", CODEX_HOME: "/option/env-home" } },
      { NODE_ENV: "test", CODEX_HOME: "/base/env-home" },
    );

    expect(env.CODEX_HOME).toBe("/option/env-home");
  });

  it("未指定 CODEX_HOME 时不注入开发隔离目录", () => {
    const env = buildCodexProcessEnv({}, { NODE_ENV: "test", PATH: "/usr/bin" });

    expect(env.CODEX_HOME).toBeUndefined();
    expect(env.RUST_LOG).toBe("warn");
  });

  it("干净环境模式不继承 broker 的敏感变量", () => {
    const env = buildCodexProcessEnv(
      {
        inheritEnv: false,
        env: { PATH: "/usr/bin", HOME: "/home/codex", CODEX_HOME: "/home/codex/CodexApp" },
      },
      { CODEX_WEB_BROKER_SESSION_SECRET: "secret", PATH: "/root/bin" },
    );

    expect(env).toMatchObject({
      PATH: "/usr/bin",
      HOME: "/home/codex",
      CODEX_HOME: "/home/codex/CodexApp",
      RUST_LOG: "warn",
    });
    expect(env.CODEX_WEB_BROKER_SESSION_SECRET).toBeUndefined();
  });
});
