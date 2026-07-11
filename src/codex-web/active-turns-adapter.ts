import type { Sourced } from "./app-server-state";
import type { AppServerTurnState } from "./turn-reducer";

export type ActiveTurnsByThreadId = Record<string, Sourced<AppServerTurnState>>;

export function sourcedActiveTurn(turn: AppServerTurnState): Sourced<AppServerTurnState> {
  return { source: "app-server.notification", data: turn };
}

export function rememberActiveTurnByThread(
  activeTurns: ActiveTurnsByThreadId,
  turn: AppServerTurnState,
): ActiveTurnsByThreadId {
  if (!turn.threadId) {
    return activeTurns;
  }

  return {
    ...activeTurns,
    [turn.threadId]: sourcedActiveTurn(turn),
  };
}

export function removeStartingActiveTurnByThread(
  activeTurns: ActiveTurnsByThreadId,
  threadId: string,
): ActiveTurnsByThreadId {
  const current = activeTurns[threadId]?.data;
  if (!current || current.turnId || current.status !== "starting") {
    return activeTurns;
  }

  const next = { ...activeTurns };
  delete next[threadId];
  return next;
}

export function selectActiveTurnByThreadIds(
  activeTurns: ActiveTurnsByThreadId,
  threadIds: Array<string | null | undefined>,
): AppServerTurnState | null {
  for (const threadId of threadIds) {
    if (!threadId) {
      continue;
    }
    const turn = activeTurns[threadId]?.data;
    if (turn) {
      return turn;
    }
  }
  return null;
}

export function selectOtherRunningActiveTurns(
  activeTurns: ActiveTurnsByThreadId,
  currentThreadIds: Array<string | null | undefined>,
): AppServerTurnState[] {
  const currentIds = new Set(currentThreadIds.filter((id): id is string => !!id));
  return Object.values(activeTurns)
    .map((entry) => entry.data)
    .filter((turn) => !!turn.threadId && !currentIds.has(turn.threadId) && isRunningActiveTurn(turn));
}

export function isRunningActiveTurn(turn: AppServerTurnState): boolean {
  return turn.status === "starting" || turn.status === "running";
}
