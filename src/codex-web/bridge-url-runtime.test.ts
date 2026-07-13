import { describe, expect, it } from "vitest";

import { resolveCodexBridgeUrl, type BridgeUrlFetch } from "./bridge-url-runtime";

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

  it("runtime API 不可用时抛出可见错误", async () => {
    const fetcher: BridgeUrlFetch = async () => ({
      ok: false,
      status: 503,
      json: async () => ({ error: "CODEX_WEB_BRIDGE_URL 未设置" }),
    });

    await expect(resolveCodexBridgeUrl("", fetcher)).rejects.toThrow("CODEX_WEB_BRIDGE_URL 未设置");
  });
});
