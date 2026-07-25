import type { TurnFileChange, TurnFileChangeSummary } from "./file-change-summary";

type GitStatusSnapshot = {
  stdout: string;
  repoRoot: string;
  cwd: string;
};

export function turnFileChangeGitPathspecs(summary: TurnFileChangeSummary): string[] {
  const paths = new Set<string>();
  for (const file of summary.files) {
    paths.add(file.path);
    if (file.kind.type === "update" && file.kind.move_path) paths.add(file.kind.move_path);
  }
  return [...paths];
}

export function filterTurnFileChangeSummaryByGitStatus(
  summary: TurnFileChangeSummary,
  snapshot: GitStatusSnapshot,
): TurnFileChangeSummary | null {
  const dirtyPaths = porcelainPaths(snapshot.stdout).map((path) => pathKey(path, snapshot.repoRoot));
  const dirtyPathSet = new Set(dirtyPaths);
  const files = summary.files.filter((file) => fileGitPaths(file, snapshot).some(
    (path) => dirtyPathSet.has(pathKey(path, snapshot.repoRoot)),
  ));
  if (files.length === 0) return null;

  return {
    fileCount: files.length,
    additions: files.reduce((total, file) => total + file.additions, 0),
    deletions: files.reduce((total, file) => total + file.deletions, 0),
    files,
    sourceBreadcrumb: summary.sourceBreadcrumb,
    lifecycleSourceBreadcrumb: "app-server.command/exec:git-status",
  };
}

function porcelainPaths(stdout: string): string[] {
  return stdout
    .split("\0")
    .filter(Boolean)
    .map((record) => /^[ MADRCU?!]{2} /.test(record) ? record.slice(3) : record)
    .map(normalizePath);
}

function fileGitPaths(file: TurnFileChange, snapshot: GitStatusSnapshot): string[] {
  const paths = [file.path];
  if (file.kind.type === "update" && file.kind.move_path) paths.push(file.kind.move_path);
  return paths.map((path) => repoRelativePath(path, snapshot.repoRoot, snapshot.cwd));
}

function repoRelativePath(path: string, repoRoot: string, cwd: string): string {
  const normalizedPath = normalizePath(path);
  const normalizedRoot = normalizePath(repoRoot);
  const normalizedCwd = normalizePath(cwd);
  if (isAbsolutePath(normalizedPath)) {
    return stripDirectoryPrefix(normalizedPath, normalizedRoot);
  }
  const cwdPrefix = stripDirectoryPrefix(normalizedCwd, normalizedRoot);
  return normalizePath(cwdPrefix ? `${cwdPrefix}/${normalizedPath}` : normalizedPath);
}

function stripDirectoryPrefix(path: string, directory: string): string {
  const caseInsensitive = /^[a-z]:\//i.test(directory);
  const comparablePath = caseInsensitive ? path.toLowerCase() : path;
  const comparableDirectory = caseInsensitive ? directory.toLowerCase() : directory;
  if (comparablePath === comparableDirectory) return "";
  const prefix = `${comparableDirectory}/`;
  return comparablePath.startsWith(prefix) ? path.slice(directory.length + 1) : path;
}

function pathKey(path: string, repoRoot: string): string {
  const normalized = normalizePath(path);
  return /^[a-z]:\//i.test(normalizePath(repoRoot)) ? normalized.toLowerCase() : normalized;
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/$/, "");
}

function isAbsolutePath(path: string): boolean {
  return path.startsWith("/") || /^[a-z]:\//i.test(path);
}
