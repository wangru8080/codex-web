import type { JsonRpcId } from "@/codex/protocol/json-rpc";

import type { AppServerPendingRequest } from "./approval-adapter";
import { approvalRequestKey } from "./approval-response-guard";

export function enqueueApproval(
  queue: AppServerPendingRequest[],
  approval: AppServerPendingRequest,
): AppServerPendingRequest[] {
  const key = approvalRequestKey(approval.requestId);
  if (queue.some((item) => approvalRequestKey(item.requestId) === key)) {
    return queue;
  }
  return [...queue, approval];
}

export function removeApproval(
  queue: AppServerPendingRequest[],
  requestId: JsonRpcId,
): AppServerPendingRequest[] {
  const key = approvalRequestKey(requestId);
  return queue.filter((item) => approvalRequestKey(item.requestId) !== key);
}

export function firstApproval(
  queue: AppServerPendingRequest[],
  predicate?: (approval: AppServerPendingRequest) => boolean,
): AppServerPendingRequest | null {
  return (predicate ? queue.find(predicate) : queue[0]) ?? null;
}

export function findApprovalByRequestId(
  queue: AppServerPendingRequest[],
  requestId: JsonRpcId,
): AppServerPendingRequest | null {
  const key = approvalRequestKey(requestId);
  return queue.find((item) => approvalRequestKey(item.requestId) === key) ?? null;
}

export function approvalRequestMatchesThread(
  approval: AppServerPendingRequest,
  threadIds: Array<string | null | undefined>,
): boolean {
  const ids = new Set(threadIds.filter((id): id is string => !!id));
  return ids.has(approval.threadId);
}

export function sourcedApproval(approval: AppServerPendingRequest | null) {
  return approval ? { source: "app-server.serverRequest" as const, data: approval } : null;
}
