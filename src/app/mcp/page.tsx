"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Phase 2D.4 (2026-05-01): `/mcp` is now a deep link into the unified
 * `/plugins` page. Kept as a thin redirect for one release so existing
 * bookmarks / tests don't 404; the file will be deleted in the next cleanup.
 */
export default function McpRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/plugins#mcp");
  }, [router]);
  return null;
}
