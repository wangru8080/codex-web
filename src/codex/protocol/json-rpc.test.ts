import { describe, expect, it } from "vitest";

import { parseJsonRpcMessage } from "./json-rpc";

describe("parseJsonRpcMessage", () => {
  it("解析 app-server request", () => {
    expect(
      parseJsonRpcMessage(
        JSON.stringify({ id: 1, method: "initialize", params: { clientInfo: {} } }),
      ),
    ).toEqual({ id: 1, method: "initialize", params: { clientInfo: {} } });
  });

  it("解析 app-server notification", () => {
    expect(
      parseJsonRpcMessage(
        JSON.stringify({ method: "thread/started", params: { threadId: "t1" } }),
      ),
    ).toEqual({ method: "thread/started", params: { threadId: "t1" } });
  });

  it("解析成功 response", () => {
    expect(
      parseJsonRpcMessage(JSON.stringify({ id: "model-list", result: { models: [] } })),
    ).toEqual({ id: "model-list", result: { models: [] } });
  });

  it("解析错误 response", () => {
    expect(
      parseJsonRpcMessage(
        JSON.stringify({ id: 7, error: { code: -32601, message: "Method not found" } }),
      ),
    ).toEqual({ id: 7, error: { code: -32601, message: "Method not found" } });
  });

  it("拒绝同时包含 result 和 error 的 response", () => {
    expect(() =>
      parseJsonRpcMessage(
        JSON.stringify({ id: 1, result: {}, error: { code: -1, message: "bad" } }),
      ),
    ).toThrow("必须且只能包含 result 或 error");
  });
});
