import type { TurnInterruptParams } from "@/codex/protocol/generated/v2/TurnInterruptParams";

export type BuildTurnInterruptParamsInput = {
  threadId: string;
  turnId?: string;
};

export type InterruptTurnParams = {
  threadId?: string;
  turnId?: string;
};

export type InterruptableTurnState = {
  threadId?: string;
  turnId?: string;
  status?: string;
} | null;

export function buildTurnInterruptParams({
  threadId,
  turnId,
}: BuildTurnInterruptParamsInput): TurnInterruptParams {
  return {
    threadId,
    turnId: turnId || "",
  };
}

export function selectTurnInterruptParams({
  activeTurn,
  params,
}: {
  activeTurn: InterruptableTurnState;
  params?: InterruptTurnParams;
}): TurnInterruptParams | null {
  const threadId = params?.threadId || activeTurn?.threadId || "";
  const turnId = params?.turnId ?? activeTurn?.turnId;
  if (!threadId || isTerminalTurnStatus(activeTurn?.status)) {
    return null;
  }

  return buildTurnInterruptParams({ threadId, turnId });
}

function isTerminalTurnStatus(status: string | undefined): boolean {
  return status === "completed" || status === "failed" || status === "interrupted";
}
