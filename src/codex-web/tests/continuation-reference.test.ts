import { describe, expect, it } from 'vitest';

import {
  continuationReferenceStorageKey,
  parseContinuationReference,
} from '../continuation-reference';

describe('接续任务导航引用', () => {
  it('按子任务保存并恢复父任务输出点', () => {
    expect(continuationReferenceStorageKey('child-1')).toBe(
      'codex-web:continuation-reference:child-1',
    );
    expect(parseContinuationReference(JSON.stringify({
      parentThreadId: 'parent-1',
      parentMessageId: 'agent-3',
      lastTurnId: 'turn-3',
    }))).toEqual({
      parentThreadId: 'parent-1',
      parentMessageId: 'agent-3',
      lastTurnId: 'turn-3',
    });
  });

  it('忽略损坏或不完整的引用', () => {
    expect(parseContinuationReference(null)).toBeNull();
    expect(parseContinuationReference('{')).toBeNull();
    expect(parseContinuationReference('{"parentThreadId":"parent-1"}')).toBeNull();
  });
});
