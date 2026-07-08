import fs from 'node:fs';
import path from 'node:path';
import { assertRealPathInBase } from './files';

/**
 * #628 — resolve an @-mention's client-supplied in-tree path to a REAL absolute
 * path, but ONLY if it stays inside the session working dir (cwd) AND is not a
 * symlink that escapes it.
 *
 * Returns the real (realpath-resolved) path when safe; returns null when the path
 * is absent / escapes cwd / is a symlink / doesn't point at an existing regular
 * file — the caller then falls back to a `.codepilot-uploads` copy (the pre-#628
 * behavior, non-destructive: the AI edits a throwaway).
 *
 * SECURITY: a string-level `path.resolve` containment check is NOT enough — an
 * in-tree symlink (e.g. `linked-secret.txt -> ../../outside`) passes a textual
 * check but a follow-the-link write escapes the project (Codex P1). We reuse the
 * project's write-path contract `assertRealPathInBase(..., rejectIfSymlink: true)`
 * (fs.realpath BOTH sides + reject final-component symlinks + isPathSafe), instead
 * of a bespoke check, so the @file path stays in lockstep with the rest of the
 * write-safety surface.
 */
export async function resolveInTreeAttachmentPath(
  originPath: string | undefined,
  workDir: string | undefined,
): Promise<string | null> {
  if (!originPath || !workDir) return null;
  const candidate = path.resolve(workDir, originPath);
  try {
    const realTarget = await assertRealPathInBase(candidate, workDir, { rejectIfSymlink: true });
    if (!realTarget) return null;
    if (!fs.statSync(realTarget).isFile()) return null; // realTarget is the physical path; statSync is safe here
    return realTarget;
  } catch {
    // path_unsafe / symlink_detected / not_found / permission → fall back to copy
    return null;
  }
}
