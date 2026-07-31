import { describe, expect, it } from "vitest";

import { parseLegacyServerLine } from "../legacy-runtime-smoke";

describe("legacy 单用户 smoke 输出解析", () => {
  it("解析生产入口打印的 HTTP 和 bridge 地址", () => {
    expect(parseLegacyServerLine("Codex Web: http://127.0.0.1:4123")).toEqual({
      baseUrl: "http://127.0.0.1:4123",
    });
    expect(parseLegacyServerLine("Codex Web bridge: ws://127.0.0.1:4123/codex-bridge?token=abc")).toEqual({
      bridgeUrl: "ws://127.0.0.1:4123/codex-bridge?token=abc",
    });
  });
});
