import type { JsonRpcId } from "@/codex/protocol/json-rpc";
import type { AppServerPendingRequest } from "./approval-adapter";

export type ApprovalResponsePhase = "idle" | "responding" | "resolved";

export type ApprovalResponseGuardState = Record<string, ApprovalResponsePhase>;

export type ApprovalResponseGuardResult =
  | {
      ok: true;
      key: string;
      state: ApprovalResponseGuardState;
    }
  | {
      ok: false;
      reason: "missing" | "stale" | "duplicate";
      key: string;
      state: ApprovalResponseGuardState;
    };

export function beginApprovalResponse({
  pendingApproval,
  requestId,
  state,
}: {
  pendingApproval: AppServerPendingRequest | null;
  requestId: JsonRpcId;
  state: ApprovalResponseGuardState;
}): ApprovalResponseGuardResult {
  const key = approvalRequestKey(requestId);
  if (!pendingApproval) {
    return { ok: false, reason: "missing", key, state };
  }

  if (approvalRequestKey(pendingApproval.requestId) !== key) {
    return { ok: false, reason: "stale", key, state };
  }

  const phase = state[key] ?? "idle";
  if (phase === "responding" || phase === "resolved") {
    return { ok: false, reason: "duplicate", key, state };
  }

  return {
    ok: true,
    key,
    state: { ...state, [key]: "responding" },
  };
}

export function completeApprovalResponse({
  key,
  state,
}: {
  key: string;
  state: ApprovalResponseGuardState;
}): ApprovalResponseGuardState {
  return { ...state, [key]: "resolved" };
}

export function failApprovalResponse({
  key,
  state,
}: {
  key: string;
  state: ApprovalResponseGuardState;
}): ApprovalResponseGuardState {
  const next = { ...state };
  delete next[key];
  return next;
}

export function approvalRequestKey(requestId: JsonRpcId): string {
  return `${typeof requestId}:${String(requestId)}`;
}
