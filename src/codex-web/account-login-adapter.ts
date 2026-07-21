import type { AccountLoginCompletedNotification } from "@/codex/protocol/generated/v2/AccountLoginCompletedNotification";
import type { LoginAccountResponse } from "@/codex/protocol/generated/v2/LoginAccountResponse";
import type { JsonRpcNotification } from "@/codex/protocol/json-rpc";

export function readAccountLoginCompletion(
  notification: JsonRpcNotification,
): AccountLoginCompletedNotification | null {
  if (notification.method !== "account/login/completed") return null;
  const params = notification.params;
  if (!params || typeof params !== "object" || Array.isArray(params)) return null;
  const { loginId, success, error } = params as Record<string, unknown>;
  if (loginId !== null && typeof loginId !== "string") return null;
  if (typeof success !== "boolean") return null;
  if (error !== null && typeof error !== "string") return null;
  return { loginId, success, error };
}

export function isAccountLoginCompletionFor(
  login: LoginAccountResponse | null,
  completion: AccountLoginCompletedNotification,
): boolean {
  if (!login) return false;
  if (login.type === "chatgpt" || login.type === "chatgptDeviceCode") {
    return completion.loginId === login.loginId;
  }
  return completion.loginId === null;
}
