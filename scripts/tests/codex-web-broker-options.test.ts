import { describe, expect, it } from "vitest";

import { parseCodexWebBrokerArgs } from "../codex-web-broker-options";

describe("codex-web runtime CLI 参数", () => {
  it("解析 serve 的绝对配置与 socket 路径", () => {
    expect(parseCodexWebBrokerArgs([
      "serve",
      "--config", "/etc/codex-web/users.json",
      "--socket", "/run/codex-web/runtime-broker.sock",
    ])).toEqual({
      command: "serve",
      configPath: "/etc/codex-web/users.json",
      socketPath: "/run/codex-web/runtime-broker.sock",
      help: false,
      version: false,
    });
  });

  it("支持 hash-password、help 和 version", () => {
    expect(parseCodexWebBrokerArgs(["hash-password"]).command).toBe("hash-password");
    expect(parseCodexWebBrokerArgs(["--help"]).help).toBe(true);
    expect(parseCodexWebBrokerArgs(["--version"]).version).toBe(true);
  });

  it("拒绝相对路径和未知参数", () => {
    expect(() => parseCodexWebBrokerArgs(["serve", "--config", "users.json", "--socket", "/run/broker.sock"]))
      .toThrow("绝对路径");
    expect(() => parseCodexWebBrokerArgs(["unknown"])).toThrow("未知命令");
  });
});
