import { describe, expect, it } from "vitest";

import type { GitChangedFile } from "@/types";
import {
  applyGitNumstat,
  buildGitCommitCommands,
  gitCommitPathspecs,
  parseGitNumstat,
  parseGitWorkspaceStatus,
} from "./git-workspace";

describe("parseGitWorkspaceStatus", () => {
  it("解析分支、上游、领先落后和 clean 状态", () => {
    expect(parseGitWorkspaceStatus("## main...origin/main [ahead 2, behind 1]\0", "/repo")).toEqual({
      isRepo: true,
      repoRoot: "/repo",
      branch: "main",
      upstream: "origin/main",
      ahead: 2,
      behind: 1,
      dirty: false,
      additions: 0,
      deletions: 0,
      changedFiles: [],
    });
  });

  it("合并同一路径的已暂存和未暂存状态并保留空格", () => {
    const status = parseGitWorkspaceStatus(
      "## feature/no-upstream\0MM src/app file.ts\0?? src/new file.ts\0",
      "/repo",
    );

    expect(status.changedFiles).toEqual([
      {
        path: "src/app file.ts",
        status: "modified",
        staged: true,
        unstaged: true,
        additions: null,
        deletions: null,
      },
      {
        path: "src/new file.ts",
        status: "untracked",
        staged: false,
        unstaged: true,
        additions: null,
        deletions: null,
      },
    ]);
  });

  it("解析 rename 的新旧路径", () => {
    const status = parseGitWorkspaceStatus(
      "## main\0R  src/new-name.ts\0src/old-name.ts\0",
      "/repo",
    );

    expect(status.changedFiles[0]).toMatchObject({
      path: "src/new-name.ts",
      originalPath: "src/old-name.ts",
      status: "renamed",
      staged: true,
      unstaged: false,
    });
  });
});

describe("Git numstat", () => {
  it("解析文本、二进制和空格路径并汇总到状态", () => {
    const stats = parseGitNumstat("2\t1\tsrc/app file.ts\0-\t-\tassets/logo.png\0");
    const status = parseGitWorkspaceStatus(
      "## main\0 M src/app file.ts\0?? assets/logo.png\0",
      "/repo",
    );

    expect([...stats]).toEqual([
      ["src/app file.ts", { additions: 2, deletions: 1 }],
      ["assets/logo.png", { additions: null, deletions: null }],
    ]);
    expect(applyGitNumstat(status, stats)).toMatchObject({
      additions: 2,
      deletions: 1,
      changedFiles: [
        { path: "src/app file.ts", additions: 2, deletions: 1 },
        { path: "assets/logo.png", additions: null, deletions: null },
      ],
    });
  });

  it("解析 no-index 未跟踪文件的 NUL 双路径格式", () => {
    expect([...parseGitNumstat("1\t0\t\0/dev/null\0src/new.ts\0")]).toEqual([
      ["src/new.ts", { additions: 1, deletions: 0 }],
    ]);
  });
});

describe("gitCommitPathspecs", () => {
  it("包含 rename 新旧路径并去重", () => {
    const files = [
      {
        path: "src/new-name.ts",
        originalPath: "src/old-name.ts",
      },
      {
        path: "src/new-name.ts",
      },
    ] as GitChangedFile[];

    expect(gitCommitPathspecs(files)).toEqual([
      "src/new-name.ts",
      "src/old-name.ts",
    ]);
  });

  it("提交命令只包含所选路径且提交信息保持单个 argv", () => {
    const files = [{
      path: "src/selected file.ts",
      status: "modified",
      staged: false,
    }] as GitChangedFile[];

    expect(buildGitCommitCommands(files, "feat: 提交；不执行 shell")).toEqual({
      stage: ["git", "--literal-pathspecs", "add", "-A", "--", "src/selected file.ts"],
      commit: [
        "git",
        "--literal-pathspecs",
        "commit",
        "--only",
        "-m",
        "feat: 提交；不执行 shell",
        "--",
        "src/selected file.ts",
      ],
    });
  });
});
