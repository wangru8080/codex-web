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

  const items = mergeTurnItems(current.items, resumed.items);
  const sameAssistantItem = current.assistantTextItemId === resumed.assistantTextItemId;
  const currentAssistantIsCommentary = !!current.assistantTextItemId && resumed.items.some(
    (item) => item.id === current.assistantTextItemId
      && item.type === "agentMessage"
      && item.phase === "commentary",
  );
  const useCurrentAssistant = !currentAssistantIsCommentary
    && !resumed.assistantTextItemId
    && !resumed.assistantText;
  const assistantText = useCurrentAssistant
    ? current.assistantText
    : sameAssistantItem
      ? mergeProgressText(current.assistantText, resumed.assistantText)
      : resumed.assistantText;
  const assistantTextItemId = useCurrentAssistant
    ? current.assistantTextItemId
    : resumed.assistantTextItemId;
  return {
    ...current,
    ...resumed,
    assistantText,
    assistantTextItemId,
    reasoningText: mergeProgressText(current.reasoningText, resumed.reasoningText),
    planText: mergeProgressText(current.planText, resumed.planText),
    latestProposedPlanMarkdown:
      resumed.latestProposedPlanMarkdown ?? current.latestProposedPlanMarkdown,
    planBlocks: resumed.planBlocks.length > 0 ? resumed.planBlocks : current.planBlocks,
    taskProgress: resumed.taskProgress ?? current.taskProgress,
    items: synchronizeAssistantItem(items, assistantTextItemId, assistantText),
    toolOutputs: mergeAccumulatedText(current.toolOutputs, resumed.toolOutputs),
    turnDiff: resumed.turnDiff || current.turnDiff,
    filePatchChanges: { ...current.filePatchChanges, ...resumed.filePatchChanges },
    mcpProgress: mergeAccumulatedText(current.mcpProgress, resumed.mcpProgress),
    contextCompactionStatusById: {
      ...current.contextCompactionStatusById,
      ...resumed.contextCompactionStatusById,
    },
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

function mergeProgressText(current: string, resumed: string): string {
  return current.startsWith(resumed) ? current : resumed;
}

function mergeAccumulatedText(
  current: Record<string, string>,
  resumed: Record<string, string>,
): Record<string, string> {
  return Object.fromEntries(
    Array.from(new Set([...Object.keys(current), ...Object.keys(resumed)]))
      .map((key) => [key, mergeProgressText(current[key] ?? "", resumed[key] ?? "")]),
  );
}

function mergeTurnItems(current: ThreadItem[], resumed: ThreadItem[]): ThreadItem[] {
  const resumedById = new Map(resumed.map((item) => [item.id, item]));
  const merged = current.map((item) => {
    const resumedItem = resumedById.get(item.id);
    if (!resumedItem) return item;
    resumedById.delete(item.id);
    return mergeTurnItem(item, resumedItem);
  });
  return [...merged, ...resumedById.values()];
}

function mergeTurnItem(current: ThreadItem, resumed: ThreadItem): ThreadItem {
  if (current.type !== resumed.type) return resumed;
  if (current.type === "agentMessage" && resumed.type === "agentMessage") {
    return { ...resumed, text: mergeProgressText(current.text, resumed.text) };
  }
  if (current.type === "plan" && resumed.type === "plan") {
    return { ...resumed, text: mergeProgressText(current.text, resumed.text) };
  }
  if (current.type === "commandExecution" && resumed.type === "commandExecution") {
    return {
      ...resumed,
      aggregatedOutput: mergeProgressText(
        current.aggregatedOutput ?? "",
        resumed.aggregatedOutput ?? "",
      ) || null,
    };
  }
  if (current.type === "reasoning" && resumed.type === "reasoning") {
    return {
      ...resumed,
      summary: resumed.summary.length > 0 ? resumed.summary : current.summary,
      content: resumed.content.length > 0 ? resumed.content : current.content,
    };
  }
  return resumed;
}

function synchronizeAssistantItem(
  items: ThreadItem[],
  itemId: string | null,
  assistantText: string,
): ThreadItem[] {
  if (!itemId) return items;
  return items.map((item) =>
    item.id === itemId && item.type === "agentMessage" && item.phase !== "commentary"
      ? { ...item, text: assistantText }
      : item,
  );
}
