import { describe, expect, it, vi } from 'vitest';

import { createFrameValueCoalescer } from './useAnimationFrameValue';

describe('帧级值合并', () => {
  it('同一帧只发布最新累计值', () => {
    let scheduled: (() => void) | null = null;
    const publish = vi.fn();
    const coalescer = createFrameValueCoalescer<string>(
      (callback) => {
        scheduled = callback;
        return 1;
      },
      vi.fn(),
      publish,
    );

    coalescer.push('a');
    coalescer.push('ab');
    coalescer.push('abc');
    expect(publish).not.toHaveBeenCalled();

    const runScheduled = scheduled as (() => void) | null;
    expect(runScheduled).not.toBeNull();
    runScheduled?.();
    expect(publish).toHaveBeenCalledOnce();
    expect(publish).toHaveBeenCalledWith('abc');
  });

  it('释放时取消尚未发布的帧', () => {
    const cancel = vi.fn();
    const coalescer = createFrameValueCoalescer(
      () => 7,
      cancel,
      vi.fn(),
    );
    coalescer.push('value');
    coalescer.dispose();
    expect(cancel).toHaveBeenCalledWith(7);
  });
});
