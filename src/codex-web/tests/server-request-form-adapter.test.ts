import { describe, expect, it } from "vitest";

import type { McpServerElicitationRequestParams } from "@/codex/protocol/generated/v2/McpServerElicitationRequestParams";
import type { ToolRequestUserInputParams } from "@/codex/protocol/generated/v2/ToolRequestUserInputParams";
import {
  AUTO_RESOLUTION_HIDDEN_GRACE_MS,
  AUTO_RESOLUTION_VISIBLE_COUNTDOWN_MS,
  buildMcpElicitationAcceptInput,
  buildToolUserInputResponseInput,
  formatAutoResolutionRemaining,
  getToolUserInputAutoResolutionTiming,
  initialMcpFormValues,
  normalizeMcpFormFields,
} from "../server-request-form-adapter";

describe("server-request-form-adapter", () => {
  it("按 question id 构造多问题答案并保留多选数组", () => {
    const params: ToolRequestUserInputParams = {
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "tool-1",
      autoResolutionMs: null,
      questions: [
        { id: "region", header: "区域", question: "部署到哪里？", isOther: true, isSecret: false, options: [] },
        { id: "token", header: "令牌", question: "输入令牌", isOther: true, isSecret: true, options: null },
      ],
    };

    expect(buildToolUserInputResponseInput(params, {
      region: ["上海", "北京"],
      token: ["secret-value"],
    })).toEqual({
      type: "userInput",
      answers: {
        region: { answers: ["上海", "北京"] },
        token: { answers: ["secret-value"] },
      },
    });
  });

  it("拒绝缺失问题、空白自由输入和未知 question id", () => {
    const params: ToolRequestUserInputParams = {
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "tool-1",
      autoResolutionMs: null,
      questions: [
        { id: "region", header: "区域", question: "部署到哪里？", isOther: true, isSecret: false, options: null },
      ],
    };

    expect(() => buildToolUserInputResponseInput(params, { region: ["  "] })).toThrow("部署到哪里？");
    expect(() => buildToolUserInputResponseInput(params, { other: ["上海"] })).toThrow("部署到哪里？");
  });

  it("归一化 MCP typed form 并应用默认值", () => {
    const params = mcpFormParams();

    expect(normalizeMcpFormFields(params)).toEqual([
      expect.objectContaining({ id: "email", kind: "string", required: true, format: "email" }),
      expect.objectContaining({ id: "retries", kind: "number", minimum: 1, maximum: 5 }),
      expect.objectContaining({ id: "enabled", kind: "boolean" }),
      expect.objectContaining({ id: "region", kind: "single", options: [{ label: "华东", value: "east" }, { label: "华北", value: "north" }] }),
      expect.objectContaining({ id: "scopes", kind: "multi", minItems: 1, maxItems: 2 }),
    ]);
    expect(initialMcpFormValues(params)).toEqual({
      retries: 3,
      enabled: false,
      region: "east",
      scopes: ["read"],
    });
  });

  it("构造 MCP accept response 并保留 string/number/boolean/array 类型", () => {
    const params = mcpFormParams();

    expect(buildMcpElicitationAcceptInput(params, {
      email: "user@example.com",
      retries: 4,
      enabled: false,
      region: "north",
      scopes: ["read", "write"],
    })).toEqual({
      type: "elicitation",
      action: "accept",
      content: {
        email: "user@example.com",
        retries: 4,
        enabled: false,
        region: "north",
        scopes: ["read", "write"],
      },
      _meta: { request: "checkout" },
    });
  });

  it("拒绝 MCP 必填缺失、范围越界、非法枚举和多选数量越界", () => {
    const params = mcpFormParams();
    const valid = {
      email: "user@example.com",
      retries: 3,
      enabled: true,
      region: "east",
      scopes: ["read"],
    };

    expect(() => buildMcpElicitationAcceptInput(params, { ...valid, email: "" })).toThrow("邮箱");
    expect(() => buildMcpElicitationAcceptInput(params, { ...valid, retries: 9 })).toThrow("重试次数");
    expect(() => buildMcpElicitationAcceptInput(params, { ...valid, region: "west" })).toThrow("区域");
    expect(() => buildMcpElicitationAcceptInput(params, { ...valid, scopes: [] })).toThrow("权限");
  });

  it("不把 openai/form 或 url 当成 typed MCP form", () => {
    expect(() => normalizeMcpFormFields({
      threadId: "thread-1",
      turnId: null,
      serverName: "demo",
      mode: "url",
      message: "登录",
      url: "https://example.com",
      elicitationId: "login-1",
      _meta: null,
    })).toThrow("不是 typed form");
  });

  it("按 TUI 固定 60 秒静默期和 60 秒可见倒计时计算自动处理状态", () => {
    const startedAtMs = 1_000;

    expect(getToolUserInputAutoResolutionTiming(null, startedAtMs, startedAtMs, false)).toEqual({
      phase: "disabled",
    });
    expect(getToolUserInputAutoResolutionTiming(240_000, startedAtMs, startedAtMs + AUTO_RESOLUTION_HIDDEN_GRACE_MS - 1, false)).toEqual({
      phase: "hiddenGrace",
      remainingMs: 1,
    });
    expect(getToolUserInputAutoResolutionTiming(60_000, startedAtMs, startedAtMs + AUTO_RESOLUTION_HIDDEN_GRACE_MS, false)).toEqual({
      phase: "visibleCountdown",
      remainingMs: AUTO_RESOLUTION_VISIBLE_COUNTDOWN_MS,
    });
    expect(getToolUserInputAutoResolutionTiming(60_000, startedAtMs, startedAtMs + AUTO_RESOLUTION_HIDDEN_GRACE_MS + AUTO_RESOLUTION_VISIBLE_COUNTDOWN_MS - 1, false)).toEqual({
      phase: "visibleCountdown",
      remainingMs: 1,
    });
    expect(getToolUserInputAutoResolutionTiming(60_000, startedAtMs, startedAtMs + AUTO_RESOLUTION_HIDDEN_GRACE_MS + AUTO_RESOLUTION_VISIBLE_COUNTDOWN_MS, false)).toEqual({
      phase: "due",
    });
  });

  it("把 autoResolutionMs 仅作为启用信号，并在用户交互后暂停自动处理", () => {
    const startedAtMs = 5_000;
    const dueAtMs = startedAtMs + AUTO_RESOLUTION_HIDDEN_GRACE_MS + AUTO_RESOLUTION_VISIBLE_COUNTDOWN_MS;

    expect(getToolUserInputAutoResolutionTiming(240_000, startedAtMs, dueAtMs, false)).toEqual({ phase: "due" });
    expect(getToolUserInputAutoResolutionTiming(60_000, startedAtMs, dueAtMs, true)).toEqual({ phase: "disabled" });
  });

  it("按 TUI 规则向上取整并格式化倒计时", () => {
    expect(formatAutoResolutionRemaining(60_000)).toBe("1m 00s");
    expect(formatAutoResolutionRemaining(59_001)).toBe("1m 00s");
    expect(formatAutoResolutionRemaining(59_000)).toBe("59s");
    expect(formatAutoResolutionRemaining(1)).toBe("1s");
  });
});

function mcpFormParams(): McpServerElicitationRequestParams {
  return {
    threadId: "thread-1",
    turnId: "turn-1",
    serverName: "payments",
    mode: "form",
    message: "付款设置",
    _meta: { request: "checkout" },
    requestedSchema: {
      type: "object",
      required: ["email", "region", "scopes"],
      properties: {
        email: { type: "string", title: "邮箱", format: "email", minLength: 3 },
        retries: { type: "integer", title: "重试次数", minimum: 1, maximum: 5, default: 3 },
        enabled: { type: "boolean", title: "启用", default: false },
        region: {
          type: "string",
          title: "区域",
          oneOf: [{ const: "east", title: "华东" }, { const: "north", title: "华北" }],
          default: "east",
        },
        scopes: {
          type: "array",
          title: "权限",
          minItems: BigInt(1),
          maxItems: BigInt(2),
          items: { type: "string", enum: ["read", "write"] },
          default: ["read"],
        },
      },
    },
  };
}
