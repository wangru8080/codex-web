"use client";

/**
 * Lightweight Context provider for the AI Elements `<Context>` family.
 *
 * Why this file exists separately:
 * `ai-elements/context.tsx` ships a full kit — Context provider +
 * HoverCard wrapper + ContextIcon + ContextTrigger + ContextContentHeader/
 * Body/Footer + ContextInputUsage / OutputUsage / CacheUsage — and pulls
 * in `tokenlens`, `@/components/ui/hover-card`, `@/components/ui/progress`,
 * and `@/components/ui/button`. Surfaces that only need to publish
 * `usedTokens / maxTokens / usage / modelId` into React context (e.g.,
 * the trigger-only `RunCockpit` shell that wraps a lazy popover) should
 * NOT statically import all of that.
 *
 * Memory contract (2026-05-09): `RunCockpit.tsx` imports `ContextProvider`
 * from this file; the lazy `RunCockpitPopoverContent.tsx` keeps importing
 * the full `Context` kit (`ContextContentHeader / Body / Footer / Input /
 * Output / Cache`). `ContextContext` is exported from THIS file — both
 * the lightweight provider and the heavy ContextContent.* consumers
 * resolve to the same React context identity (single module, single
 * `createContext` call), so the popover's consumers read the values the
 * shell publishes without ceremony.
 *
 * Locked in by `src/__tests__/unit/chat-static-graph.test.ts`.
 */

import {
  createContext,
  useContext,
  useMemo,
  type ReactNode,
} from "react";
import type { LanguageModelUsage } from "ai";

export interface ContextSchema {
  usedTokens: number;
  maxTokens: number;
  usage?: LanguageModelUsage;
  modelId?: string;
}

export const ContextContext = createContext<ContextSchema | null>(null);

export const useContextValue = (): ContextSchema => {
  const context = useContext(ContextContext);
  if (!context) {
    throw new Error("Context components must be used within Context");
  }
  return context;
};

export interface ContextProviderProps extends ContextSchema {
  children: ReactNode;
}

/**
 * Provider-only `<Context>` substitute. No HoverCard wrapper, so it
 * doesn't pull in HoverCard / Progress / Button / tokenlens. The full
 * `<Context>` from `./context` adds those when surfaces need the
 * hover-card behavior; surfaces that only need the React-context
 * channel use this instead.
 */
export const ContextProvider = ({
  usedTokens,
  maxTokens,
  usage,
  modelId,
  children,
}: ContextProviderProps) => {
  const value = useMemo<ContextSchema>(
    () => ({ maxTokens, modelId, usage, usedTokens }),
    [maxTokens, modelId, usage, usedTokens],
  );
  return (
    <ContextContext.Provider value={value}>
      {children}
    </ContextContext.Provider>
  );
};
