import { describe, expect, it } from "vitest";

import type { JsonRpcNotification } from "@/codex/protocol/json-rpc";
import type { LoginAccountResponse } from "@/codex/protocol/generated/v2/LoginAccountResponse";
import {
  isAccountLoginCompletionFor,
  readAccountLoginCompletion,
} from "../account-login-adapter";

describe("Codex 账户登录通知适配", () => {
  it("只读取 account/login/completed 通知", () => {
    expect(readAccountLoginCompletion({
      method: "account/login/completed",
      params: { loginId: "login-1", success: true, error: null },
    })).toEqual({ loginId: "login-1", success: true, error: null });

    expect(readAccountLoginCompletion({
      method: "account/updated",
      params: { authMode: "chatgpt", planType: "plus" },
    })).toBeNull();
  });

  it("保留 app-server 返回的失败原因", () => {
    const notification = {
      method: "account/login/completed",
      params: { loginId: "login-2", success: false, error: "授权已过期" },
    } satisfies JsonRpcNotification;

    expect(readAccountLoginCompletion(notification)).toEqual({
      loginId: "login-2",
      success: false,
      error: "授权已过期",
    });
  });

  it("只用相同 loginId 收口 ChatGPT 登录", () => {
    const login = {
      type: "chatgpt",
      loginId: "login-current",
      authUrl: "https://chatgpt.com/auth",
    } satisfies LoginAccountResponse;

    expect(isAccountLoginCompletionFor(login, {
      loginId: "login-current",
      success: true,
      error: null,
    })).toBe(true);
    expect(isAccountLoginCompletionFor(login, {
      loginId: "login-old",
      success: true,
      error: null,
    })).toBe(false);
  });

  it("API Key 登录只匹配无 loginId 的完成通知", () => {
    const login = { type: "apiKey" } satisfies LoginAccountResponse;

    expect(isAccountLoginCompletionFor(login, {
      loginId: null,
      success: true,
      error: null,
    })).toBe(true);
    expect(isAccountLoginCompletionFor(login, {
      loginId: "chatgpt-login",
      success: true,
      error: null,
    })).toBe(false);
  });
});
