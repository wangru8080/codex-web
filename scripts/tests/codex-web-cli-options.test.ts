import { describe, expect, it } from "vitest";

import { parseCodexWebCliArgs, parseCodexWebCommand } from "../codex-web-cli-options";

describe("parseCodexWebCommand", () => {
  it("支持显式 serve 和 legacy 单用户参数", () => {
    expect(parseCodexWebCommand(["serve", "--port", "4100"])).toEqual({
      command: "serve",
      args: ["--port", "4100"],
    });
    expect(parseCodexWebCommand(["--port", "4100"])).toEqual({
      command: "serve",
      args: ["--port", "4100"],
    });
  });

  it("将 runtime 子命令参数原样交给 runtime CLI", () => {
    expect(parseCodexWebCommand([
      "runtime", "serve", "--config", "/etc/codex-web/users.json",
    ])).toEqual({
      command: "runtime",
      args: ["serve", "--config", "/etc/codex-web/users.json"],
    });
    expect(parseCodexWebCommand(["runtime", "hash-password"])).toEqual({
      command: "runtime",
      args: ["hash-password"],
    });
  });

  it("拒绝未知顶层命令", () => {
    expect(() => parseCodexWebCommand(["unknown"])).toThrow("未知命令");
  });
});

describe("parseCodexWebCliArgs", () => {
  it("默认仅监听本机并使用固定端口和用户 Codex Home", () => {
    expect(parseCodexWebCliArgs([], {}, "/home/tester")).toEqual({
      host: "127.0.0.1",
      publicHost: "127.0.0.1",
      port: 3001,
      codexHome: "/home/tester/.codex",
      open: false,
      help: false,
      version: false,
    });
  });

  it("命令行参数覆盖环境变量", () => {
    expect(parseCodexWebCliArgs([
      "--host", "0.0.0.0",
      "--port", "4123",
      "--codex-home", "/tmp/codex-home",
      "--open",
    ], {
      CODEX_WEB_NEXT_HOST: "10.0.0.1",
      CODEX_WEB_PUBLIC_HOST: "web.example.test",
      PORT: "4100",
      CODEX_HOME: "/tmp/from-env",
    }, "/home/tester")).toEqual({
      host: "0.0.0.0",
      publicHost: "0.0.0.0",
      port: 4123,
      codexHome: "/tmp/codex-home",
      open: true,
      help: false,
      version: false,
    });
  });

  it("没有命令行覆盖时保留显式环境配置", () => {
    expect(parseCodexWebCliArgs([], {
      CODEX_WEB_NEXT_HOST: "0.0.0.0",
      CODEX_WEB_PUBLIC_HOST: "codex.example.test",
      PORT: "4200",
      CODEX_HOME: "/srv/codex-home",
    }, "/home/tester")).toMatchObject({
      host: "0.0.0.0",
      publicHost: "codex.example.test",
      port: 4200,
      codexHome: "/srv/codex-home",
    });
  });

  it("识别帮助和版本参数", () => {
    expect(parseCodexWebCliArgs(["--help"], {}, "/home/tester").help).toBe(true);
    expect(parseCodexWebCliArgs(["--version"], {}, "/home/tester").version).toBe(true);
  });

  it("拒绝未知参数、缺失参数值和非法端口", () => {
    expect(() => parseCodexWebCliArgs(["--unknown"], {}, "/home/tester")).toThrow("未知参数");
    expect(() => parseCodexWebCliArgs(["--host"], {}, "/home/tester")).toThrow("--host 需要一个值");
    expect(() => parseCodexWebCliArgs(["--port", "65536"], {}, "/home/tester")).toThrow("--port");
  });
});
