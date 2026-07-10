import type { JsonRpcId } from "@/codex/protocol/json-rpc";

import type { AppServerApprovalRequest } from "./approval-adapter";
import { approvalRequestKey } from "./approval-response-guard";

export function enqueueApproval(
  queue: AppServerApprovalRequest[],
  approval: AppServerApprovalRequest,
): AppServerApprovalRequest[] {
  const key = approvalRequestKey(approval.requestId);
  if (queue.some((item) => approvalRequestKey(item.requestId) === key)) {
    return queue;
  }
  return [...queue, approval];
}

export function removeApproval(
  queue: AppServerApprovalRequest[],
  requestId: JsonRpcId,
): AppServerApprovalRequest[] {
  const key = approvalRequestKey(requestId);
  return queue.filter((item) => approvalRequestKey(item.requestId) !== key);
}

export function firstApproval(
  queue: AppServerApprovalRequest[],
  predicate?: (approval: AppServerApprovalRequest) => boolean,
): AppServerApprovalRequest | null {
  return (predicate ? queue.find(predicate) : queue[0]) ?? null;
}

export function findApprovalByRequestId(
  queue: AppServerApprovalRequest[],
  requestId: JsonRpcId,
): AppServerApprovalRequest | null {
  const key = approvalRequestKey(requestId);
  return queue.find((item) => approvalRequestKey(item.requestId) === key) ?? null;
}

export function approvalRequestMatchesThread(
  approval: AppServerApprovalRequest,
  threadIds: Array<string | null | undefined>,
): boolean {
  const ids = new Set(threadIds.filter((id): id is string => !!id));
  return ids.has(approval.threadId);
}

export function sourcedApproval(approval: AppServerApprovalRequest | null) {
  return approval ? { source: "app-server.serverRequest" as const, data: approval } : null;
}
