import type { GitChangedFile, GitHistoryEntry, GitHistoryFile, GitStatus } from "@/types";

type GitNumstat = {
  additions: number | null;
  deletions: number | null;
};

export function parseGitWorkspaceStatus(stdout: string, repoRoot: string): GitStatus {
  const records = stdout.split("\0").filter(Boolean);
  const branch = parseBranch(records[0]?.startsWith("## ") ? records.shift()!.slice(3) : "");
  const changedFiles: GitChangedFile[] = [];

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (record.length < 3) continue;
    const indexStatus = record[0];
    const worktreeStatus = record[1];
    if (indexStatus === "!" && worktreeStatus === "!") continue;
    const statusCode = worktreeStatus !== " " && worktreeStatus !== "?"
      ? worktreeStatus
      : indexStatus;
    const renamed = statusCode === "R" || statusCode === "C";

    changedFiles.push({
      path: record.slice(3),
      ...(renamed && records[index + 1] ? { originalPath: records[++index] } : {}),
      status: statusFromCode(statusCode, indexStatus, worktreeStatus),
      staged: indexStatus !== " " && indexStatus !== "?",
      unstaged: worktreeStatus !== " " || indexStatus === "?",
      additions: null,
      deletions: null,
    });
  }

  return {
    isRepo: true,
    repoRoot,
    ...branch,
    dirty: changedFiles.length > 0,
    additions: 0,
    deletions: 0,
    changedFiles,
  };
}

export function parseGitNumstat(stdout: string): Map<string, GitNumstat> {
  const stats = new Map<string, GitNumstat>();
  const records = stdout.split("\0");
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!record) continue;
    const firstTab = record.indexOf("\t");
    const secondTab = record.indexOf("\t", firstTab + 1);
    if (firstTab < 0 || secondTab < 0) continue;
    const additions = record.slice(0, firstTab);
    const deletions = record.slice(firstTab + 1, secondTab);
    const inlinePath = record.slice(secondTab + 1);
    const path = inlinePath || records[index + 2];
    if (!inlinePath) index += 2;
    if (!path) continue;
    stats.set(path, {
      additions: additions === "-" ? null : Number(additions),
      deletions: deletions === "-" ? null : Number(deletions),
    });
  }
  return stats;
}

export function applyGitNumstat(status: GitStatus, stats: Map<string, GitNumstat>): GitStatus {
  const changedFiles = status.changedFiles.map((file) => {
    const stat = stats.get(file.path) ?? (file.originalPath ? stats.get(file.originalPath) : undefined);
    return stat ? { ...file, ...stat } : file;
  });
  return {
    ...status,
    additions: changedFiles.reduce((total, file) => total + (file.additions ?? 0), 0),
    deletions: changedFiles.reduce((total, file) => total + (file.deletions ?? 0), 0),
    changedFiles,
  };
}

export function gitCommitPathspecs(files: GitChangedFile[]): string[] {
  const paths = new Set<string>();
  for (const file of files) {
    paths.add(file.path);
    if (file.originalPath) paths.add(file.originalPath);
  }
  return [...paths];
}

export function buildGitCommitCommands(files: GitChangedFile[], message: string) {
  const paths = gitCommitPathspecs(files);
  return {
    stage: ['git', '--literal-pathspecs', 'add', '-A', '--', ...paths],
    commit: ['git', '--literal-pathspecs', 'commit', '--only', '-m', message, '--', ...paths],
  };
}

export function parseGitHistory(stdout: string): GitHistoryEntry[] {
  return stdout
    .split("\x1e")
    .filter(Boolean)
    .map((record) => {
      const [sha = "", authorName = "", authorEmail = "", timestamp = "", message = ""] = record
        .replace(/\r?\n$/, "")
        .split("\0");
      return {
        sha: assertGitCommitSha(sha),
        authorName,
        authorEmail,
        timestamp,
        message,
      };
    });
}

export function parseGitHistoryFiles(stdout: string): GitHistoryFile[] {
  const records = stdout.split("\0").filter(Boolean);
  const files: GitHistoryFile[] = [];
  for (let index = 0; index < records.length; index += 2) {
    const code = records[index];
    const firstPath = records[index + 1];
    if (!code || !firstPath) continue;
    const renamed = code.startsWith("R") || code.startsWith("C");
    const path = renamed ? records[index + 2] : firstPath;
    if (!path) continue;
    files.push({
      path,
      ...(renamed ? { originalPath: firstPath } : {}),
      status: historyStatusFromCode(code),
    });
    if (renamed) index += 1;
  }
  return files;
}

export function gitHistoryPathspecs(file: GitHistoryFile): string[] {
  return file.originalPath ? [file.path, file.originalPath] : [file.path];
}

export function assertGitCommitSha(sha: string): string {
  if (!/^[0-9a-f]{40}$/i.test(sha)) throw new Error("无效的 Git commit SHA");
  return sha.toLowerCase();
}

function parseBranch(value: string): Pick<GitStatus, "branch" | "upstream" | "ahead" | "behind"> {
  const normalized = value.replace(/^No commits yet on /, "");
  const [branch = "", upstreamWithCounts = ""] = normalized.split("...", 2);
  return {
    branch: branch === "HEAD (no branch)" ? "HEAD" : branch,
    upstream: upstreamWithCounts.replace(/ \[.*\]$/, ""),
    ahead: Number(upstreamWithCounts.match(/ahead (\d+)/)?.[1] ?? 0),
    behind: Number(upstreamWithCounts.match(/behind (\d+)/)?.[1] ?? 0),
  };
}

function statusFromCode(
  code: string,
  indexStatus: string,
  worktreeStatus: string,
): GitChangedFile["status"] {
  if (indexStatus === "?" && worktreeStatus === "?") return "untracked";
  if (code === "A") return "added";
  if (code === "D") return "deleted";
  if (code === "R") return "renamed";
  if (code === "C") return "copied";
  return "modified";
}

function historyStatusFromCode(code: string): GitHistoryFile["status"] {
  if (code.startsWith("A")) return "added";
  if (code.startsWith("D")) return "deleted";
  if (code.startsWith("R")) return "renamed";
  if (code.startsWith("C")) return "copied";
  return "modified";
}
