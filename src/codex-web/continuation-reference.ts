export type ContinuationReference = {
  parentThreadId: string;
  parentMessageId: string;
  lastTurnId: string;
};

const STORAGE_PREFIX = 'codex-web:continuation-reference:';

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
