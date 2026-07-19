"use client";

import { useEffect, useState } from "react";

export const COMPACT_VIEWPORT_QUERY = "(max-width: 1023px)";

export function useCompactViewport(): boolean | null {
  const [compactViewport, setCompactViewport] = useState<boolean | null>(null);

  useEffect(() => {
    const mediaQuery = window.matchMedia(COMPACT_VIEWPORT_QUERY);
    const syncViewport = () => setCompactViewport(mediaQuery.matches);
    syncViewport();
    mediaQuery.addEventListener("change", syncViewport);
    return () => mediaQuery.removeEventListener("change", syncViewport);
  }, []);

  return compactViewport;
}
