import type { Message } from "@/types";

export type HistoryPaginationNotice = {
  message: string;
  description?: string;
};

export type HistoryPaginationFailureState = {
  messages: Message[];
  hasMore: false;
  nextCursor: null;
  notice: HistoryPaginationNotice;
};

export function isUnsupportedTurnsListError(error: unknown): boolean {
  if (!error) return false;
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return (
    message.includes("list_turns is not supported yet") ||
    message.includes("not supported") ||
    message.includes("method not found") ||
    message.includes("unknown method")
  );
}

export function historyPaginationFailureNotice(error: unknown, isEnglish = false): HistoryPaginationNotice {
  return {
    message: isEnglish ? "History pagination is unavailable" : "历史分页暂不可用",
    description: error instanceof Error ? error.message : String(error),
  };
}

export function preserveMessagesAfterPaginationFailure(
  messages: Message[],
  error: unknown,
  isEnglish = false,
): HistoryPaginationFailureState {
  return {
    messages,
    hasMore: false,
    nextCursor: null,
    notice: historyPaginationFailureNotice(error, isEnglish),
  };
}
