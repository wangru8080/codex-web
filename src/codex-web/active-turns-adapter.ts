import type { SourceBreadcrumb, Sourced } from "./app-server-state";
import type { AppServerTurnState } from "./turn-reducer";

export type ActiveTurnsByThreadId = Record<string, Sourced<AppServerTurnState>>;

export function sourcedActiveTurn(
  turn: AppServerTurnState,
  source: SourceBreadcrumb = "app-server.notification",
): Sourced<AppServerTurnState> {
  return { source, data: turn };
}

export function rememberActiveTurnByThread(
  activeTurns: ActiveTurnsByThreadId,
  turn: AppServerTurnState,
  source: SourceBreadcrumb = "app-server.notification",
): ActiveTurnsByThreadId {
  if (!turn.threadId) {
    return activeTurns;
  }

  return {
    ...activeTurns,
    [turn.threadId]: sourcedActiveTurn(turn, source),
  };
}

export function removeActiveTurnByThread(
  activeTurns: ActiveTurnsByThreadId,
  threadId: string,
): ActiveTurnsByThreadId {
  if (!activeTurns[threadId]) {
    return activeTurns;
  }
  const next = { ...activeTurns };
  delete next[threadId];
  return next;
}

export function failRunningTurnOnTransportClose(
  turn: Sourced<AppServerTurnState> | null,
  message: string,
): Sourced<AppServerTurnState> | null {
  if (!turn || !isRunningActiveTurn(turn.data)) {
    return turn;
  }

  return {
    source: "web-bridge",
    data: {
      ...turn.data,
      status: "failed",
      errorMessage: message,
    },
  };
}

export function failRunningTurnsOnTransportClose(
  turns: ActiveTurnsByThreadId,
  message: string,
): ActiveTurnsByThreadId {
  let changed = false;
  const next = Object.fromEntries(Object.entries(turns).map(([key, turn]) => {
    const failed = failRunningTurnOnTransportClose(turn, message);
    changed ||= failed !== turn;
    return [key, failed];
  })) as ActiveTurnsByThreadId;
  return changed ? next : turns;
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
