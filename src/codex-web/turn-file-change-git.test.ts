import { describe, expect, it } from "vitest";

import type { TurnFileChangeSummary } from "./file-change-summary";
import {
  filterTurnFileChangeSummaryByGitStatus,
  turnFileChangeGitPathspecs,
} from "./turn-file-change-git";

const summary: TurnFileChangeSummary = {
  fileCount: 2,
  additions: 3,
  deletions: 1,
  files: [
    {
      path: "src/app.ts",
      kind: { type: "update", move_path: null },
      diff: "-old\n+next\n+export",
      additions: 2,
      deletions: 1,
    },
    {
      path: "src/new.ts",
      kind: { type: "add" },
      diff: "+new",
      additions: 1,
      deletions: 0,
    },
  ],
  sourceBreadcrumb: "app-server.item/fileChange/patchUpdated",
};

describe("filterTurnFileChangeSummaryByGitStatus", () => {
  it("相关路径全部提交后返回 null", () => {
    expect(filterTurnFileChangeSummaryByGitStatus(summary, {
      stdout: "",
      repoRoot: "/workspace",
      cwd: "/workspace",
    })).toBeNull();
  });

  it("部分提交后只保留未提交文件并重新统计", () => {
    expect(filterTurnFileChangeSummaryByGitStatus(summary, {
      stdout: "?? src/new.ts\0",
      repoRoot: "/workspace",
      cwd: "/workspace",
    })).toEqual({
      fileCount: 1,
      additions: 1,
      deletions: 0,
      files: [summary.files[1]],
      sourceBreadcrumb: "app-server.item/fileChange/patchUpdated",
      lifecycleSourceBreadcrumb: "app-server.command/exec:git-status",
    });
  });

  it("匹配仓库子目录中的相对路径和绝对路径", () => {
    const nestedSummary: TurnFileChangeSummary = {
      ...summary,
      files: [
        summary.files[0],
        { ...summary.files[1], path: "/repo/packages/web/src/new.ts" },
      ],
    };

    expect(filterTurnFileChangeSummaryByGitStatus(nestedSummary, {
      stdout: " M packages/web/src/app.ts\0?? packages/web/src/new.ts\0",
      repoRoot: "/repo",
      cwd: "/repo/packages/web",
    })?.files.map((file) => file.path)).toEqual([
      "src/app.ts",
      "/repo/packages/web/src/new.ts",
    ]);
  });

  it("rename 的目标或来源仍未提交时保留对应变更", () => {
    const renamed: TurnFileChangeSummary = {
      ...summary,
      fileCount: 1,
      additions: 2,
      deletions: 1,
      files: [{
        ...summary.files[0],
        path: "src/new-name.ts",
        kind: { type: "update", move_path: "src/old-name.ts" },
      }],
    };

    expect(filterTurnFileChangeSummaryByGitStatus(renamed, {
      stdout: "R  src/new-name.ts\0src/old-name.ts\0",
      repoRoot: "/workspace",
      cwd: "/workspace",
    })?.fileCount).toBe(1);
  });
});

describe("turnFileChangeGitPathspecs", () => {
  it("包含修改路径和移动来源路径并去重", () => {
    const renamed: TurnFileChangeSummary = {
      ...summary,
      files: [{
        ...summary.files[0],
        path: "src/new-name.ts",
        kind: { type: "update", move_path: "src/old-name.ts" },
      }],
    };

    expect(turnFileChangeGitPathspecs(renamed)).toEqual([
      "src/new-name.ts",
      "src/old-name.ts",
    ]);
  });
});
