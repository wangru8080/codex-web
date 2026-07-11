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

export function historyPaginationFailureNotice(error: unknown): HistoryPaginationNotice {
  return {
    message: "历史分页暂不可用",
    description: error instanceof Error ? error.message : String(error),
  };
}

export function preserveMessagesAfterPaginationFailure(
  messages: Message[],
  error: unknown,
): HistoryPaginationFailureState {
  return {
    messages,
    hasMore: false,
    nextCursor: null,
    notice: historyPaginationFailureNotice(error),
  };
}
