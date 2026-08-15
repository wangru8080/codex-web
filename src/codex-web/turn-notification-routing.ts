import {
  initialAppServerTurnState,
  type AppServerTurnState,
} from "./turn-reducer";

type TurnNotificationIds = {
  threadId?: string;
  turnId?: string;
};

export function turnNotificationBase({
  activeTurn,
  snapshotTurn,
  ids,
}: {
  activeTurn: AppServerTurnState | null;
  snapshotTurn: AppServerTurnState | null;
  ids: TurnNotificationIds;
}): AppServerTurnState {
  if (ids.threadId && ids.turnId) {
    if (snapshotTurn?.threadId === ids.threadId && snapshotTurn.turnId === ids.turnId) {
      return snapshotTurn;
    }
    if (activeTurn?.threadId === ids.threadId && activeTurn.turnId === ids.turnId) {
      return activeTurn;
    }
    return initialAppServerTurnState;
  }

  if (ids.threadId && activeTurn?.threadId === ids.threadId) return activeTurn;
  if (!ids.threadId && !ids.turnId && activeTurn) return activeTurn;
  return initialAppServerTurnState;
}

export function shouldUpdateActiveTurnFromNotification(
  activeTurn: AppServerTurnState | null,
  ids: TurnNotificationIds,
  method?: string,
): boolean {
  if (!activeTurn) return true;
  if (ids.threadId && activeTurn.threadId && ids.threadId !== activeTurn.threadId) return false;
  if (!ids.turnId || !activeTurn.turnId || ids.turnId === activeTurn.turnId) return true;
  return method === "turn/started";
}
