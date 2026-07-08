/**
 * Phase 4 P2.2 — refresh URL builder for Markdown→HTML presentations.
 *
 * Extracted from PreviewPanel.handleRefreshPresentation so the trust-
 * scope wiring can be tested without React. The function answers
 * "given this backlink + current workingDirectory, which
 * /api/files/preview URL should the refresh action fetch?"
 *
 * The fix (relative to the original implementation) is to honour the
 * trust tier captured at generation time:
 *  - sourceTrust === 'workspace'    → use sourceBaseDir (or fall back
 *                                     to workingDirectory if the
 *                                     legacy backlink didn't capture
 *                                     a baseDir)
 *  - sourceTrust === 'user-selected'→ pass NO baseDir; route falls
 *                                     back to homeDir, same scope the
 *                                     original load used
 *  - missing / other                → fall back to the current
 *                                     workingDirectory (back-compat
 *                                     for backlinks written before
 *                                     this fix landed)
 */

import type { PreviewSourceBacklink } from "@/hooks/usePanel";

export function buildPresentationRefreshUrl(
  backlink: Pick<PreviewSourceBacklink, "sourcePath" | "sourceTrust" | "sourceBaseDir">,
  workingDirectory: string | null | undefined,
): string {
  const qs = new URLSearchParams({ path: backlink.sourcePath });
  let baseDir: string | undefined;
  if (backlink.sourceTrust === "workspace") {
    baseDir = backlink.sourceBaseDir ?? workingDirectory ?? undefined;
  } else if (backlink.sourceTrust === "user-selected") {
    baseDir = undefined;
  } else {
    baseDir = backlink.sourceBaseDir ?? workingDirectory ?? undefined;
  }
  if (baseDir) qs.set("baseDir", baseDir);
  return `/api/files/preview?${qs}`;
}
