export type ContinuationReference = {
  parentThreadId: string;
  parentMessageId: string;
  lastTurnId: string;
};

const STORAGE_PREFIX = 'codex-web:continuation-reference:';
const TARGET_MESSAGE_PARAM = 'continuationMessage';

export function continuationReferenceStorageKey(childThreadId: string): string {
  return `${STORAGE_PREFIX}${childThreadId}`;
}

export function parseContinuationReference(value: string | null): ContinuationReference | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<ContinuationReference>;
    if (!parsed.parentThreadId || !parsed.parentMessageId || !parsed.lastTurnId) return null;
    return {
      parentThreadId: parsed.parentThreadId,
      parentMessageId: parsed.parentMessageId,
      lastTurnId: parsed.lastTurnId,
    };
  } catch {
    return null;
  }
}

export function continuationParentHref(parentThreadId: string, parentMessageId: string): string {
  const query = new URLSearchParams({ [TARGET_MESSAGE_PARAM]: parentMessageId });
  return `/chat/${encodeURIComponent(parentThreadId)}?${query}#msg-${encodeURIComponent(parentMessageId)}`;
}

export function needsContinuationTargetHistory(
  messageIds: readonly string[],
  targetMessageId?: string,
): boolean {
  return !!targetMessageId && !messageIds.includes(targetMessageId);
}

type CompleteContinuationForkOptions = {
  rename?: () => Promise<void>;
  saveReference?: () => void;
  navigate: () => void;
  onPostProcessError?: (error: unknown) => void;
};

export async function completeContinuationFork({
  rename,
  saveReference,
  navigate,
  onPostProcessError,
}: CompleteContinuationForkOptions): Promise<void> {
  try {
    await rename?.();
  } catch (error) {
    onPostProcessError?.(error);
  }
  try {
    saveReference?.();
  } catch (error) {
    onPostProcessError?.(error);
  }
  navigate();
}
