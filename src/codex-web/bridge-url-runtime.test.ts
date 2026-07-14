import { describe, expect, it } from "vitest";

import {
  resolveBridgeEndpoint,
  resolveCodexBridgeHomeDirectory,
  resolveCodexBridgeUrl,
  type BridgeUrlFetch,
} from "./bridge-url-runtime";

describe("bridge url runtime resolver", () => {
  it("优先使用构建期公开 bridge URL", async () => {
    const url = await resolveCodexBridgeUrl("ws://127.0.0.1:1234?token=dev", async () => {
      throw new Error("不应请求 runtime API");
    });

    expect(url).toBe("ws://127.0.0.1:1234?token=dev");
  });

  it("没有公开 URL 时从 runtime API 读取生产 bridge URL", async () => {
    const calls: string[] = [];
    const fetcher: BridgeUrlFetch = async (input, init) => {
      calls.push(`${input}:${init?.cache ?? ""}`);
      return {
        ok: true,
        status: 200,
        json: async () => ({ bridgeUrl: "ws://192.168.3.12:4567?token=prod" }),
      };
    };

    await expect(resolveCodexBridgeUrl("", fetcher)).resolves.toBe(
      "ws://192.168.3.12:4567?token=prod",
    );
    expect(calls).toEqual(["/api/codex/bridge-url:no-store"]);
  });

  it("把同源 bridge path 转成当前 HTTP 页面的 WebSocket URL", async () => {
    const location = { protocol: "http:", host: "localhost:4567" };
    expect(resolveBridgeEndpoint("/codex-bridge?token=x", location)).toBe(
      "ws://localhost:4567/codex-bridge?token=x",
    );

    const fetcher: BridgeUrlFetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ bridgeUrl: "/codex-bridge?token=prod" }),
    });
    await expect(resolveCodexBridgeUrl("", fetcher, location)).resolves.toBe(
      "ws://localhost:4567/codex-bridge?token=prod",
    );
  });

  it("把同源 bridge path 转成当前 HTTPS 页面的安全 WebSocket URL", () => {
    expect(resolveBridgeEndpoint("/codex-bridge?token=x", {
      protocol: "https:",
      host: "codex.example.com",
    })).toBe("wss://codex.example.com/codex-bridge?token=x");
  });

  it("runtime API 不可用时抛出可见错误", async () => {
    const fetcher: BridgeUrlFetch = async () => ({
      ok: false,
      status: 503,
      json: async () => ({ error: "CODEX_WEB_BRIDGE_URL 未设置" }),
    });

    await expect(resolveCodexBridgeUrl("", fetcher)).rejects.toThrow("CODEX_WEB_BRIDGE_URL 未设置");
  });

  it("从 bridge runtime API 读取当前服务用户主目录", async () => {
    const fetcher: BridgeUrlFetch = async () => ({
      ok: false,
      status: 503,
      json: async () => ({
        error: "CODEX_WEB_BRIDGE_URL 未设置",
        homeDirectory: "/home/rrssnas",
      }),
    });

    await expect(resolveCodexBridgeHomeDirectory(fetcher)).resolves.toBe("/home/rrssnas");
  });

  it("bridge runtime API 未返回主目录时拒绝使用猜测路径", async () => {
    const fetcher: BridgeUrlFetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ bridgeUrl: "/codex-bridge?token=test" }),
    });

    await expect(resolveCodexBridgeHomeDirectory(fetcher)).rejects.toThrow("主目录未设置");
  });
});
