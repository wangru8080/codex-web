import { describe, expect, it } from 'vitest';

import {
  classifyMessageWindowChange,
  continuationMarkerIndex,
  nextVirtualFirstItemIndex,
} from '../message-list-virtualization';

describe('消息虚拟窗口变化', () => {
  it('识别保留旧首项的历史前插', () => {
    const change = classifyMessageWindowChange(['m3', 'm4'], ['m1', 'm2', 'm3', 'm4']);
    expect(change).toEqual({ type: 'prepend', count: 2 });
    expect(nextVirtualFirstItemIndex(1_000_000, change)).toBe(999_998);
  });

  it('识别前插后裁掉尾部的内存上限场景', () => {
    expect(classifyMessageWindowChange(
      ['m3', 'm4', 'm5', 'm6'],
      ['m1', 'm2', 'm3', 'm4'],
    )).toEqual({ type: 'prepend', count: 2 });
  });

  it('区分追加、内容更新和会话替换', () => {
    expect(classifyMessageWindowChange(['m1'], ['m1', 'm2'])).toEqual({ type: 'append', count: 1 });
    expect(classifyMessageWindowChange(['m1'], ['m1'])).toEqual({ type: 'items-change' });
    expect(classifyMessageWindowChange(['m1'], ['other'])).toEqual({ type: 'replace' });
  });
});

describe('接续任务边界', () => {
  it('追加新消息后仍紧跟继承的最后一条消息', () => {
    expect(continuationMarkerIndex(['m1', 'm2', 'm3'], 'm2')).toBe(2);
    expect(continuationMarkerIndex(['m1', 'm2', 'm3', 'm4', 'm5'], 'm2')).toBe(2);
  });

  it('找不到继承消息时不插入标记', () => {
    expect(continuationMarkerIndex(['m1'], 'missing')).toBe(-1);
    expect(continuationMarkerIndex(['m1'], undefined)).toBe(-1);
  });
});
