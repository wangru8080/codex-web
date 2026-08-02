export interface ModelSwitch {
  id: string;
  from: string;
  to: string;
  afterMessageId: string | null;
  afterTurnId?: string | null;
}

interface ModelSwitchStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function storageKey(threadId: string): string {
  return `codex-web:model-switches:${threadId}`;
}

export function readModelSwitches(storage: ModelSwitchStorage, threadId: string): ModelSwitch[] {
  try {
    const value: unknown = JSON.parse(storage.getItem(storageKey(threadId)) ?? '[]');
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is ModelSwitch => {
      if (!item || typeof item !== 'object') return false;
      const change = item as Partial<ModelSwitch>;
      return typeof change.id === 'string'
        && typeof change.from === 'string'
        && typeof change.to === 'string'
        && (typeof change.afterMessageId === 'string' || change.afterMessageId === null)
        && (change.afterTurnId === undefined || typeof change.afterTurnId === 'string' || change.afterTurnId === null);
    });
  } catch {
    return [];
  }
}

export function modelSwitchFollowsMessage(
  change: ModelSwitch,
  message: { id: string; turn_id?: string },
  index: number,
  messages: readonly { id: string; turn_id?: string }[],
): boolean {
  if (!change.afterTurnId) return change.afterMessageId === message.id;
  return message.turn_id === change.afterTurnId
    && !messages.slice(index + 1).some((candidate) => candidate.turn_id === change.afterTurnId);
}

export function writeModelSwitches(
  storage: ModelSwitchStorage,
  threadId: string,
  changes: readonly ModelSwitch[],
): void {
  storage.setItem(storageKey(threadId), JSON.stringify(changes));
}
