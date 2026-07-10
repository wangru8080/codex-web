import type { SortDirection } from "@/codex/protocol/generated/v2/SortDirection";
import type { Thread } from "@/codex/protocol/generated/v2/Thread";
import type { Turn } from "@/codex/protocol/generated/v2/Turn";
import type { TurnItemsView } from "@/codex/protocol/generated/v2/TurnItemsView";
import type { Message } from "@/types";

import type {
  HistoryTurnStatusSource,
  LatestHistoryTurn,
} from "./active-turn-visibility-adapter";
import { threadToMessages } from "./thread-history-adapter";

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
): Message[] {
  const chronologicalTurns = sortDirection === "desc" ? [...turns].reverse() : turns;
  return threadToMessages({ ...thread, turns: chronologicalTurns }).messages;
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
