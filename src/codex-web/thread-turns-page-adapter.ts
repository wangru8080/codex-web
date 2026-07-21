import type { SortDirection } from "@/codex/protocol/generated/v2/SortDirection";
import type { Thread } from "@/codex/protocol/generated/v2/Thread";
import type { Turn } from "@/codex/protocol/generated/v2/Turn";
import type { TurnItemsView } from "@/codex/protocol/generated/v2/TurnItemsView";
import type { Message } from "@/types";

import type {
  HistoryTurnStatusSource,
  LatestHistoryTurn,
} from "./active-turn-visibility-adapter";
import { appServerTurnToMessageContent } from "./app-server-message-blocks";
import type { Sourced } from "./app-server-state";
import {
  threadToMessages,
  type ThreadMessagesOptions,
} from "./thread-history-adapter";
import { appServerTurnSnapshotKey, type AppServerTurnState } from "./turn-reducer";

export type ThreadTurnsListParams = {
  threadId: string;
  cursor?: string | null;
  limit?: number | null;
  sortDirection?: SortDirection | null;
  itemsView?: TurnItemsView | null;
};

export type ThreadTurnsListResponse = {
  data: Turn[];
  nextCursor: string | null;
  backwardsCursor: string | null;
};

export type MergeThreadTurnMessagesPlacement = "prepend" | "append";

export function threadTurnsPageToMessages(
  thread: Thread,
  turns: Turn[],
  sortDirection: SortDirection = "desc",
  turnSnapshots: Record<string, Sourced<AppServerTurnState>> = {},
  options: ThreadMessagesOptions = {},
): Message[] {
  const chronologicalTurns = sortDirection === "desc" ? [...turns].reverse() : turns;
  const pageThread = { ...thread, turns: chronologicalTurns };
  return applyTurnSnapshotsToMessages(
    pageThread,
    threadToMessages(pageThread, options).messages,
    turnSnapshots,
  );
}

export function latestHistoryTurnFromPage(
  turns: Turn[],
  sortDirection: SortDirection,
  source: HistoryTurnStatusSource,
): LatestHistoryTurn | null {
  const latestTurn = sortDirection === "desc" ? turns[0] : turns[turns.length - 1];
  if (!latestTurn) return null;

  return {
    status: latestTurn.status,
    source,
  };
}

export function mergeThreadTurnMessages(
  existing: Message[],
  incoming: Message[],
  placement: MergeThreadTurnMessagesPlacement,
): Message[] {
  const seen = new Set<string>();
  const result: Message[] = [];
  const candidates = placement === "prepend" ? [...incoming, ...existing] : [...existing, ...incoming];

  for (const message of candidates) {
    const key = message.id || `${message.session_id}:${message.role}:${message.created_at}:${message.content}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(message);
  }

  return result;
}

export function applyTurnSnapshotsToMessages(
  thread: Thread,
  messages: Message[],
  turnSnapshots: Record<string, Sourced<AppServerTurnState>>,
): Message[] {
  if (messages.length === 0) return messages;

  let next = messages;
  for (const turn of thread.turns) {
    const snapshot = turnSnapshots[appServerTurnSnapshotKey(thread.id, turn.id)]?.data;
    if (!isReplayableCompletedSnapshot(snapshot)) continue;

    const assistantMessageId = findAssistantHistoryMessageId(turn);
    if (!assistantMessageId) continue;

    next = next.map((message) =>
      message.id === assistantMessageId && message.session_id === thread.id && message.role === "assistant"
        ? { ...message, content: appServerTurnToMessageContent(snapshot) }
        : message,
    );
  }

  return next;
}

function isReplayableCompletedSnapshot(turn: AppServerTurnState | undefined): turn is AppServerTurnState {
  if (!turn || turn.status !== "completed") return false;
  return !!turn.assistantText.trim() || turn.reasoningText.trim().length > 0 || turn.items.length > 0;
}

function findAssistantHistoryMessageId(turn: Turn): string | null {
  const assistantItem = turn.items.find((item) => item.type !== "userMessage");
  return assistantItem?.id ?? null;
}
