import type { AppServerTurnState } from "./turn-reducer";

type LiveTurnPresentationArgs = {
  turn: AppServerTurnState | null;
  localStreaming: boolean;
  finalizedTurnKey: string;
};

export function appServerTurnPresentationKey(turn: AppServerTurnState | null): string {
  return turn?.threadId && turn.turnId ? `${turn.threadId}:${turn.turnId}` : "";
}

export function shouldPresentAppServerTurnAsStreaming({
  turn,
  localStreaming,
  finalizedTurnKey,
}: LiveTurnPresentationArgs): boolean {
  if (!turn) return false;
  const turnKey = appServerTurnPresentationKey(turn);
  if (turnKey && turnKey === finalizedTurnKey) return false;
  return localStreaming || turn?.status === "running";
}
