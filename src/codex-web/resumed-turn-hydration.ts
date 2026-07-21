import type { ThreadItem } from "@/codex/protocol/generated/v2/ThreadItem";
import type { ThreadResumeResponse } from "@/codex/protocol/generated/v2/ThreadResumeResponse";

import {
  createAcceptedTurnState,
  reduceAppServerTurnNotification,
  turnStartedAtMs,
  type AppServerTurnState,
} from "./turn-reducer";

export function activeTurnFromResume(response: ThreadResumeResponse): AppServerTurnState | null {
  const turn = response.thread.turns.at(-1);
  if (!turn || turn.status !== "inProgress") {
    return null;
  }

  let state = createAcceptedTurnState(
    response.thread.id,
    turn.id,
    turnStartedAtMs(turn.startedAt),
  );
  for (const item of turn.items) {
    state = reduceAppServerTurnNotification(state, {
      method: itemIsInProgress(item) ? "item/started" : "item/completed",
      params: { threadId: response.thread.id, turnId: turn.id, item },
    });
  }

  return {
    ...state,
    status: "running",
    durationMs: turn.durationMs ?? undefined,
    toolOutputs: collectToolOutputs(turn.items),
  };
}

function itemIsInProgress(item: ThreadItem): boolean {
  return "status" in item && item.status === "inProgress";
}

function collectToolOutputs(items: ThreadItem[]): Record<string, string> {
  return Object.fromEntries(
    items.flatMap((item) =>
      item.type === "commandExecution" && item.aggregatedOutput
        ? [[item.id, item.aggregatedOutput]]
        : [],
    ),
  );
}
