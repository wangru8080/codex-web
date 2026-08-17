import type { AppServerTurnState } from "./turn-reducer";

const storageKey = "codex-web:resumable-turns:v1";

type TurnStorage = Pick<Storage, "getItem" | "setItem">;

export function writeResumableTurns(
  storage: TurnStorage,
  turns: AppServerTurnState[],
): void {
  try {
    storage.setItem(storageKey, JSON.stringify(Object.fromEntries(
      turns
        .filter((turn) => turn.status === "running" && turn.threadId && turn.turnId)
        .map((turn) => [turn.threadId, turn]),
    )));
  } catch {
    // 浏览器禁用或写满 sessionStorage 时，实时运行不应受影响。
  }
}

export function readResumableTurn(
  storage: TurnStorage,
  threadId: string,
): AppServerTurnState | null {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(storageKey) ?? "{}");
    if (!isRecord(parsed)) return null;
    const turn = parsed[threadId];
    return isResumableTurn(turn, threadId) ? turn : null;
  } catch {
    return null;
  }
}

function isResumableTurn(value: unknown, threadId: string): value is AppServerTurnState {
  if (!isRecord(value)) return false;
  return value.status === "running"
    && value.threadId === threadId
    && typeof value.turnId === "string"
    && !!value.turnId
    && typeof value.assistantText === "string"
    && (typeof value.assistantTextItemId === "string" || value.assistantTextItemId === null)
    && typeof value.reasoningText === "string"
    && typeof value.planText === "string"
    && Array.isArray(value.planBlocks)
    && Array.isArray(value.items)
    && isRecord(value.toolOutputs)
    && typeof value.turnDiff === "string"
    && isRecord(value.filePatchChanges)
    && isRecord(value.mcpProgress)
    && isRecord(value.contextCompactionStatusById);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
