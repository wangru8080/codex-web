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

type TurnInterruptRequester = (params: TurnInterruptParams) => Promise<unknown>;

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
  const statusAppliesToSelectedThread =
    !!activeTurn?.threadId && activeTurn.threadId === threadId;
  const selectedStatus = statusAppliesToSelectedThread ? activeTurn?.status : undefined;
  if (!threadId || isTerminalTurnStatus(selectedStatus)) {
    return null;
  }

  return buildTurnInterruptParams({ threadId, turnId });
}

export async function requestTurnInterrupt(
  request: TurnInterruptRequester,
  params: TurnInterruptParams,
): Promise<void> {
  try {
    await request(params);
  } catch (error) {
    const actualTurnId = readActiveTurnIdMismatch(error);
    if (!actualTurnId || actualTurnId === params.turnId) {
      throw error;
    }
    await request({ ...params, turnId: actualTurnId });
  }
}

export function readActiveTurnIdMismatch(error: unknown): string | null {
  const message = error instanceof Error ? error.message : String(error);
  const prefix = "expected active turn id ";
  const separator = " but found ";
  if (!message.startsWith(prefix)) {
    return null;
  }
  const mismatch = message.slice(prefix.length).split(separator);
  if (mismatch.length !== 2) {
    return null;
  }
  const actualTurnId = mismatch[1]?.trim();
  return actualTurnId || null;
}

function isTerminalTurnStatus(status: string | undefined): boolean {
  return status === "completed" || status === "failed" || status === "interrupted";
}
