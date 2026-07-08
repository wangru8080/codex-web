'use client';

import type { ReactNode } from 'react';

interface ChatComposerActionBarProps {
  /** User-adjustable selects (mode / permission / model override) — left half. */
  left?: ReactNode;
  /** Read-only run status (Runtime / Auto-Pinned / Context / Health) — right half. */
  right?: ReactNode;
}

export function ChatComposerActionBar({ left, right }: ChatComposerActionBarProps) {
  return (
    <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-2 px-4 pt-0.5 pb-2.5">
      <div className="flex items-center gap-1">
        {left}
      </div>
      <div className="flex items-center gap-1">
        {right}
      </div>
    </div>
  );
}
