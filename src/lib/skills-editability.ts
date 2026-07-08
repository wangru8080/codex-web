/**
 * Skills editability resolver.
 *
 * Decides whether a skill row in the manager UI is editable / deletable,
 * and if not, surfaces a typed reason so the UI can render an explanatory
 * tooltip without re-deriving anything client-side. (Phase 2D.1, 2026-04-30.)
 */

import fs from "fs";
import path from "path";

export type SkillSource = "global" | "project" | "plugin" | "installed" | "sdk";
export type SkillReadOnlyReason = "sdk" | "file_not_writable" | "out_of_cwd";

export interface SkillEditabilityInput {
  source: SkillSource;
  filePath: string;
}

export interface SkillEditabilityResult {
  editable: boolean;
  readOnlyReason?: SkillReadOnlyReason;
}

/**
 * Pure-ish: takes a skill record + the active cwd, returns whether the
 * UI should expose edit/delete affordances.
 *
 * Rules (order matters):
 *   1. SDK skills → never editable. The Agent SDK owns them.
 *   2. Project skills must live inside the resolved cwd subtree.
 *      Without an active cwd we report `out_of_cwd` rather than guessing.
 *   3. Empty filePath → read-only by default (no file to write to).
 *   4. fs.access W_OK is the final gate for file-backed sources.
 *
 * Filesystem checks are synchronous on purpose — `/api/skills` already
 * walks dozens of files, the marginal stat() per file is negligible
 * compared to the existing readdirSync / readFileSync pass.
 */
export function deriveSkillEditability(
  skill: SkillEditabilityInput,
  cwd?: string,
): SkillEditabilityResult {
  if (skill.source === "sdk") {
    return { editable: false, readOnlyReason: "sdk" };
  }

  if (skill.source === "project") {
    if (!cwd) {
      return { editable: false, readOnlyReason: "out_of_cwd" };
    }
    const resolvedCwd = path.resolve(cwd);
    const resolvedFile = path.resolve(skill.filePath);
    const inCwd =
      resolvedFile === resolvedCwd ||
      resolvedFile.startsWith(resolvedCwd + path.sep);
    if (!inCwd) {
      return { editable: false, readOnlyReason: "out_of_cwd" };
    }
  }

  if (!skill.filePath) {
    return { editable: false, readOnlyReason: "file_not_writable" };
  }

  try {
    fs.accessSync(skill.filePath, fs.constants.W_OK);
    return { editable: true };
  } catch {
    return { editable: false, readOnlyReason: "file_not_writable" };
  }
}
