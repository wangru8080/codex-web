import { describe, expect, it } from 'vitest';
import { modelSwitchFollowsMessage, readModelSwitches, writeModelSwitches } from '../model-switch-storage';

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
}

describe('模型切换标识存储', () => {
  it('按会话恢复合法标识，并忽略损坏数据', () => {
    const storage = memoryStorage();
    const changes = [{ id: 'switch-1', from: 'gpt-5.5', to: 'gpt-5.6-sol', afterMessageId: 'assistant-1', afterTurnId: 'turn-1' }];

    writeModelSwitches(storage, 'thread-1', changes);

    expect(readModelSwitches(storage, 'thread-1')).toEqual(changes);
    expect(readModelSwitches(storage, 'thread-2')).toEqual([]);
    storage.setItem('codex-web:model-switches:thread-1', '{bad json');
    expect(readModelSwitches(storage, 'thread-1')).toEqual([]);
  });

  it('刷新后按稳定 turn ID 跟随该轮最后一条消息', () => {
    const change = { id: 'switch-1', from: 'gpt-5.5', to: 'gpt-5.6-sol', afterMessageId: 'temp-assistant-1', afterTurnId: 'turn-1' };
    const messages = [
      { id: 'user-1', turn_id: 'turn-1' },
      { id: 'assistant-official-1', turn_id: 'turn-1' },
      { id: 'user-2', turn_id: 'turn-2' },
    ];

    expect(modelSwitchFollowsMessage(change, messages[0], 0, messages)).toBe(false);
    expect(modelSwitchFollowsMessage(change, messages[1], 1, messages)).toBe(true);
  });
});
