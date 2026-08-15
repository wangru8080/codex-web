/**
 * Preview source classification — Phase 4 Phase 1 (Markdown / Artifact closure).
 *
 * The `kind: 'file'` variant of PreviewSource carries a `trust` tier so the
 * UI can decide whether to fetch the path automatically, whether to allow
 * editing, and whether the shell needs to surface a confirm-before-open
 * card. The previous shape had every file path implicitly trusted as
 * workspace-scoped, which broke down once the chat-side DiffSummary card
 * started feeding paths reported by AI tools (which can be outside the
 * project root). See `docs/insights/markdown-artifact-overhaul.md`.
 *
 * Tiers:
 *  - 'workspace'        : path lives under sessionWorkingDirectory. Loads
 *                         via /api/files/preview with baseDir; editable
 *                         per existing rules.
 *  - 'user-selected'    : path is outside the workspace, the user has
 *                         explicitly authorized opening it (confirmed an
 *                         agent-referenced card, or picked via file dialog).
 *                         Loads without baseDir (route scopes to homeDir).
 *                         Defaults to readonly so writes don't escape the
 *                         project root silently.
 *  - 'agent-referenced' : path was named by an AI tool and lives outside
 *                         the workspace. Must NOT be fetched until the
 *                         user confirms — the panel renders a confirm
 *                         card and on accept the source transitions to
 *                         'user-selected'.
 */
export type PreviewTrust = 'workspace' | 'user-selected' | 'agent-referenced';

export interface PathClassification {
  trust: PreviewTrust;
  /**
   * The baseDir the panel should send to /api/files/preview (and writes).
   * Only set for workspace tier; user-selected / agent-referenced leave
   * this undefined so the route falls back to homeDir scoping.
   */
  baseDir?: string;
  /**
   * Whether the panel should default to readonly. workspace = false (the
   * existing edit-and-autosave loop stays untouched). user-selected and
   * agent-referenced both default to true; the caller can flip this to
   * false on user-selected if a future "edit external file" affordance
   * lands, but Phase 1 keeps external files read-only.
   */
  readonly: boolean;
}

type PreviewPathMetadata = {
  isSymlink: boolean;
};

/**
 * Normalize a path to forward slashes + collapse trailing slash. Frontend
 * doesn't have Node's `path.resolve`; we just need consistent comparison
 * for "is child under parent" against the working directory.
 *
 * Case is preserved — macOS HFS+ / APFS default to case-insensitive but
 * the tool output we compare against (workingDirectory + tool input)
 * comes from the same shell process, so casing matches in practice.
 */
function normalize(p: string): string {
  if (!p) return '';
  const source = p.replace(/\\/g, '/');
  const drive = source.match(/^([A-Za-z]:)(?:\/|$)/)?.[1] ?? '';
  const absolute = source.startsWith('/') || !!drive;
  const root = drive ? `${drive.toLowerCase()}/` : absolute ? '/' : '';
  const body = drive ? source.slice(drive.length) : source;
  const segments: string[] = [];

  for (const segment of body.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      if (segments.length > 0) segments.pop();
      else if (!absolute) segments.push(segment);
      continue;
    }
    segments.push(segment);
  }

  return root + segments.join('/');
}

function isUnderDirectory(child: string, parent: string): boolean {
  const c = normalize(child);
  const p = normalize(parent);
  if (!c || !p) return false;
  const caseInsensitive = /^[a-z]:\//i.test(p);
  const comparableChild = caseInsensitive ? c.toLowerCase() : c;
  const comparableParent = caseInsensitive ? p.toLowerCase() : p;
  if (comparableChild === comparableParent) return true;
  return comparableChild.startsWith(`${comparableParent.replace(/\/$/, '')}/`);
}

export function workspacePathsToInspect(filePath: string, workingDirectory: string): string[] {
  const file = normalize(filePath);
  const workspace = normalize(workingDirectory).replace(/\/$/, '');
  if (!file || !workspace || !isUnderDirectory(file, workspace) || file === workspace) return [];

  const relative = file.slice(workspace.length).replace(/^\//, '');
  const separator = workingDirectory.includes('\\') ? '\\' : '/';
  let current = workspace.replace(/\//g, separator);
  return relative.split('/').filter(Boolean).map((segment) => {
    current = `${current.replace(/[\\/]$/, '')}${separator}${segment}`;
    return current;
  });
}

export async function workspacePathRequiresConfirmation(
  filePath: string,
  workingDirectory: string,
  getMetadata: (path: string) => Promise<PreviewPathMetadata>,
): Promise<boolean> {
  const paths = workspacePathsToInspect(filePath, workingDirectory);
  if (paths.length === 0 && normalize(filePath) !== normalize(workingDirectory)) return true;
  try {
    for (const path of paths) {
      if ((await getMetadata(path)).isSymlink) return true;
    }
    return false;
  } catch {
    return true;
  }
}

/**
 * Classify a file path against the current workingDirectory.
 *
 * Empty / null workingDirectory ⇒ we can't tell scope, so the path is
 * treated as agent-referenced and the user has to confirm before fetch.
 * This mirrors the production case where a chat is opened without a
 * resolved cwd yet (very early page state) — better to ask the user
 * than to blindly open paths we can't scope.
 *
 * Frontend-only: this helper does NOT enforce filesystem-level
 * permissions. `/api/files/preview` still runs `assertRealPathInBase`
 * + symlink checks on every read. The classification only controls UI
 * affordances (confirm card, readonly chip, baseDir hint).
 */
export function classifyPath(
  filePath: string,
  workingDirectory: string | null | undefined,
): PathClassification {
  if (!workingDirectory) {
    return { trust: 'agent-referenced', readonly: true };
  }
  if (isUnderDirectory(filePath, workingDirectory)) {
    return { trust: 'workspace', baseDir: workingDirectory, readonly: false };
  }
  return { trust: 'agent-referenced', readonly: true };
}
