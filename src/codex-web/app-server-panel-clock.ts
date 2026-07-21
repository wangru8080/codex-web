import type { AppServerTurnState } from "./turn-reducer";

export function resolveAppServerPanelStartedAt(
  turn: AppServerTurnState | null,
  localStartedAt: number,
  nowMs = Date.now(),
): number {
  if (turn?.startedAtMs !== undefined) {
    return turn.startedAtMs;
  }

  const isTerminal =
    turn?.status === "completed" ||
    turn?.status === "failed" ||
    turn?.status === "interrupted";
  if (isTerminal && turn.durationMs !== undefined) {
    return nowMs - turn.durationMs;
  }

  return localStartedAt;
}
