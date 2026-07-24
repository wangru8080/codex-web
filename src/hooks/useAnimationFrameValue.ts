'use client';

import { useEffect, useRef, useState } from 'react';

type FrameScheduler = (callback: () => void) => number;
type FrameCanceller = (handle: number) => void;

export function createFrameValueCoalescer<Value>(
  schedule: FrameScheduler,
  cancel: FrameCanceller,
  publish: (value: Value) => void,
) {
  let frame: number | null = null;
  let latest: Value;

  return {
    push(value: Value) {
      latest = value;
      if (frame !== null) return;
      frame = schedule(() => {
        frame = null;
        publish(latest);
      });
    },
    dispose() {
      if (frame !== null) cancel(frame);
      frame = null;
    },
  };
}

export function useAnimationFrameValue<Value>(value: Value): Value {
  const [framedValue, setFramedValue] = useState(value);
  const coalescerRef = useRef<ReturnType<typeof createFrameValueCoalescer<Value>> | null>(null);

  useEffect(() => {
    coalescerRef.current = createFrameValueCoalescer(
      (callback) => window.requestAnimationFrame(callback),
      (handle) => window.cancelAnimationFrame(handle),
      setFramedValue,
    );
    return () => coalescerRef.current?.dispose();
  }, []);

  useEffect(() => {
    coalescerRef.current?.push(value);
  }, [value]);

  return framedValue;
}
