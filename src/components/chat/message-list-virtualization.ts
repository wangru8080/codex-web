export const INITIAL_VIRTUAL_FIRST_ITEM_INDEX = 1_000_000;

export type MessageWindowChange =
  | { type: 'prepend'; count: number }
  | { type: 'append'; count: number }
  | { type: 'items-change' }
  | { type: 'replace' };

export function classifyMessageWindowChange(
  previousIds: readonly string[],
  nextIds: readonly string[],
): MessageWindowChange {
  if (previousIds.length === 0 || nextIds.length === 0) return { type: 'replace' };
  if (arraysEqual(previousIds, nextIds)) return { type: 'items-change' };

  const previousFirstIndex = nextIds.indexOf(previousIds[0]);
  if (previousFirstIndex > 0) {
    const overlapLength = Math.min(previousIds.length, nextIds.length - previousFirstIndex);
    if (arraysEqual(
      previousIds.slice(0, overlapLength),
      nextIds.slice(previousFirstIndex, previousFirstIndex + overlapLength),
    )) {
      return { type: 'prepend', count: previousFirstIndex };
    }
  }

  const appendOverlapLength = Math.min(previousIds.length, nextIds.length);
  if (arraysEqual(
    previousIds.slice(0, appendOverlapLength),
    nextIds.slice(0, appendOverlapLength),
  ) && nextIds.length > previousIds.length) {
    return { type: 'append', count: nextIds.length - previousIds.length };
  }

  return { type: 'replace' };
}

export function nextVirtualFirstItemIndex(
  current: number,
  change: MessageWindowChange,
): number {
  return change.type === 'prepend' ? current - change.count : current;
}

export function continuationMarkerIndex(
  messageIds: readonly string[],
  afterMessageId?: string,
): number {
  if (!afterMessageId) return -1;
  const messageIndex = messageIds.indexOf(afterMessageId);
  return messageIndex < 0 ? -1 : messageIndex + 1;
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
