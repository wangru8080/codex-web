"use client";

/**
 * Sync a tab selection with `window.location.hash` (Phase 2D.4, 2026-05-01).
 *
 * Why this hook exists separately from `useSearchParams`:
 *   - Next App Router's `useSearchParams` does NOT include `#fragment`.
 *   - The server never sees the hash — it's a client-only construct.
 *
 * Behavior:
 *   1. On mount, parse `window.location.hash` and adopt it if it's one
 *      of the allowed values; otherwise fall back to `defaultTab`.
 *   2. Switching the tab calls `history.replaceState` so we don't push
 *      a new entry per click — the back button still goes "back to
 *      where you came from", not "back through your tab clicks".
 *   3. We listen for `hashchange` (browser back / forward, paste-link
 *      from another tab) and update the active tab accordingly.
 *
 * Hydration note: SSR has no hash, so the first render always uses
 * `defaultTab`. Direct visits to `/plugins#mcp` therefore briefly show
 * the default tab before the mount effect re-syncs to "mcp". Acceptable
 * for a tab-switch (no data fetch tied to the initial paint).
 */

import { useCallback, useEffect, useState } from "react";

export interface UseTabFromHashOptions<T extends string> {
  /** Allowed tab keys, in order. Hashes outside this list are ignored. */
  validTabs: readonly T[];
  /** Tab to render before the first hash sync (and when hash is empty/invalid). */
  defaultTab: T;
}

function readHashTab<T extends string>(
  validTabs: readonly T[],
  defaultTab: T,
): T {
  if (typeof window === "undefined") return defaultTab;
  const raw = window.location.hash.replace(/^#/, "").trim();
  return (validTabs as readonly string[]).includes(raw) ? (raw as T) : defaultTab;
}

export function useTabFromHash<T extends string>({
  validTabs,
  defaultTab,
}: UseTabFromHashOptions<T>): [T, (next: T) => void] {
  const [tab, setTabState] = useState<T>(defaultTab);

  // Mount: read hash; subscribe to subsequent hash changes (browser
  // back/forward + paste-link from another window).
  // Note: `history.replaceState` does NOT fire `hashchange` per spec,
  // so an internal setTab → replaceState won't bounce back here. We
  // therefore don't need any "ignore self-trigger" flag — earlier
  // versions had one and silently swallowed the user's first real
  // back/forward after a click. (Phase 2D.4 P2 fix, 2026-05-01.)
  useEffect(() => {
    setTabState(readHashTab(validTabs, defaultTab));

    const onHashChange = () => {
      setTabState(readHashTab(validTabs, defaultTab));
    };

    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
    // validTabs is a stable readonly tuple in practice; including it
    // would force callers to memoize. Same for defaultTab.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setTab = useCallback((next: T) => {
    setTabState(next);
    if (typeof window !== "undefined") {
      // Use replaceState so tab switches don't pollute browser history.
      const nextHash = `#${next}`;
      if (window.location.hash !== nextHash) {
        window.history.replaceState(null, "", nextHash);
      }
    }
  }, []);

  return [tab, setTab];
}
