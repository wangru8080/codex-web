import { EventEmitter } from "node:events";
import type { IncomingMessage } from "node:http";
import { describe, expect, it } from "vitest";

import { isLocalhost, validateBridgeRequest } from "./security";

describe("isLocalhost", () => {
  it("接受 IPv4、IPv6 和 IPv4 映射 localhost", () => {
    expect(isLocalhost("127.0.0.1")).toBe(true);
    expect(isLocalhost("::1")).toBe(true);
    expect(isLocalhost("::ffff:127.0.0.1")).toBe(true);
  });

  it("拒绝非 localhost 地址", () => {
    expect(isLocalhost("192.168.3.12")).toBe(false);
  });
});

describe("validateBridgeRequest", () => {
  it("接受 bearer token 和默认 localhost origin", () => {
    const request = requestStub({
      remoteAddress: "127.0.0.1",
      headers: {
        authorization: "Bearer secret",
        origin: "http://localhost:3000",
      },
    });

    expect(validateBridgeRequest(request, { token: "secret" })).toEqual({ ok: true });
  });

  it("接受 query token", () => {
    const request = requestStub({
      remoteAddress: "127.0.0.1",
      url: "/bridge?token=secret",
      headers: {},
    });

    expect(validateBridgeRequest(request, { token: "secret" })).toEqual({ ok: true });
  });

  it("拒绝无效 token", () => {
    const request = requestStub({
      remoteAddress: "127.0.0.1",
      headers: { authorization: "Bearer wrong" },
    });

    expect(validateBridgeRequest(request, { token: "secret" })).toEqual({
      ok: false,
      statusCode: 401,
      message: "bridge token 无效",
    });
  });

  it("拒绝默认列表外的浏览器 origin", () => {
    const request = requestStub({
      remoteAddress: "127.0.0.1",
      headers: {
        authorization: "Bearer secret",
        origin: "https://evil.example",
      },
    });

    expect(validateBridgeRequest(request, { token: "secret" })).toEqual({
      ok: false,
      statusCode: 403,
      message: "Origin 不在允许列表",
    });
  });

  it("仅在显式开启时接受带白名单 Origin 的远程验证连接", () => {
    const request = requestStub({
      remoteAddress: "192.168.3.12",
      headers: {
        authorization: "Bearer secret",
        origin: "http://192.168.3.12:3000",
      },
    });

    expect(validateBridgeRequest(request, { token: "secret" })).toEqual({
      ok: false,
      statusCode: 403,
      message: "只允许 localhost 连接",
    });
    expect(
      validateBridgeRequest(request, {
        token: "secret",
        allowedOrigins: ["http://192.168.3.12:3000"],
        allowRemoteConnections: true,
      }),
    ).toEqual({ ok: true });
  });
});

function requestStub(input: {
  remoteAddress: string;
  url?: string;
  headers: Record<string, string>;
}): IncomingMessage {
  const request = new EventEmitter() as IncomingMessage;
  request.url = input.url;
  request.headers = input.headers;
  Object.defineProperty(request, "socket", {
    value: { remoteAddress: input.remoteAddress },
  });
  return request;
}
