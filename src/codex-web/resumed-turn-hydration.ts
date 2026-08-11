import type { ThreadItem } from "@/codex/protocol/generated/v2/ThreadItem";
import type { ThreadResumeResponse } from "@/codex/protocol/generated/v2/ThreadResumeResponse";
import type { Turn } from "@/codex/protocol/generated/v2/Turn";

import {
  createAcceptedTurnState,
  reduceAppServerTurnNotification,
  turnStartedAtMs,
  type AppServerTurnState,
} from "./turn-reducer";

export function activeTurnFromResume(response: ThreadResumeResponse): AppServerTurnState | null {
  const turn = response.thread.turns.at(-1);
  if (!turn || latestInProgressTurnId(response.thread.turns) !== turn.id) {
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

export function mergeResumedActiveTurn(
  current: AppServerTurnState | null | undefined,
  resumed: AppServerTurnState | null,
): AppServerTurnState | null {
  if (
    !current ||
    !resumed ||
    current.threadId !== resumed.threadId ||
    current.turnId !== resumed.turnId
  ) {
    return resumed;
  }

  const assistantText = longerText(current.assistantText, resumed.assistantText);
  return {
    ...resumed,
    assistantText,
    assistantTextItemId:
      assistantText === current.assistantText
        ? current.assistantTextItemId
        : resumed.assistantTextItemId,
    reasoningText: longerText(current.reasoningText, resumed.reasoningText),
    toolOutputs: mergeAccumulatedText(current.toolOutputs, resumed.toolOutputs),
  };
}

export function latestInProgressTurnId(turns: Turn[]): string | null {
  const latest = turns.at(-1);
  return latest?.status === "inProgress" ? latest.id : null;
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

function longerText(current: string, resumed: string): string {
  return resumed.length >= current.length ? resumed : current;
}

function mergeAccumulatedText(
  current: Record<string, string>,
  resumed: Record<string, string>,
): Record<string, string> {
  return Object.fromEntries(
    Array.from(new Set([...Object.keys(current), ...Object.keys(resumed)]))
      .map((key) => [key, longerText(current[key] ?? "", resumed[key] ?? "")]),
  );
}
