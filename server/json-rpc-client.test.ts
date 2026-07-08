import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";

import { JsonRpcClient } from "./json-rpc-client";

describe("JsonRpcClient", () => {
  it("发送 request 并解析 response", async () => {
    const { client, input, output } = createClient();
    const promise = client.request("model/list", { includeHidden: false });

    expect(readWrittenJson(output)).toEqual({
      id: 1,
      method: "model/list",
      params: { includeHidden: false },
    });

    input.write(`${JSON.stringify({ id: 1, result: { models: [] } })}\n`);
    await expect(promise).resolves.toEqual({ models: [] });
  });

  it("把 app-server notification 分发给监听器", () => {
    const { client, input } = createClient();
    const onNotification = vi.fn();
    client.on("notification", onNotification);

    input.write(`${JSON.stringify({ method: "thread/started", params: { threadId: "t1" } })}\n`);

    expect(onNotification).toHaveBeenCalledWith({
      method: "thread/started",
      params: { threadId: "t1" },
    });
  });

  it("把带 id 的 app-server method 消息识别为 server request", () => {
    const { client, input } = createClient();
    const onServerRequest = vi.fn();
    client.on("serverRequest", onServerRequest);

    input.write(`${JSON.stringify({ id: "approval-1", method: "item/permissions/requestApproval" })}\n`);

    expect(onServerRequest).toHaveBeenCalledWith({
      id: "approval-1",
      method: "item/permissions/requestApproval",
    });
  });

  it("transport close 时快速失败 pending request", async () => {
    const closeEmitter = new EventEmitter();
    const { client } = createClient(closeEmitter);
    const promise = client.request("model/list");

    closeEmitter.emit("exit");

    await expect(promise).rejects.toThrow("app-server 进程已退出");
  });
});

function createClient(closeEmitter?: EventEmitter): {
  client: JsonRpcClient;
  input: PassThrough;
  output: PassThrough;
} {
  const input = new PassThrough();
  const output = new PassThrough();
  const options = closeEmitter === undefined
    ? { input, output }
    : { input, output, closeEmitter };
  return {
    client: new JsonRpcClient(options),
    input,
    output,
  };
}

function readWrittenJson(output: PassThrough): unknown {
  const chunk = output.read();
  if (!Buffer.isBuffer(chunk)) {
    throw new Error("未读取到 JSON-RPC 输出");
  }
  return JSON.parse(chunk.toString("utf8"));
}
