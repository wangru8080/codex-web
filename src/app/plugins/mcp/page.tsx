"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Legacy `/plugins/mcp` URL — redirects into the unified `/plugins`
 * page's MCP tab. Kept for backwards compatibility (helpers + bookmarks
 * still reference this path). Phase 2D.4 (2026-05-01).
 */
export default function McpRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/plugins#mcp");
  }, [router]);
  return null;
}
