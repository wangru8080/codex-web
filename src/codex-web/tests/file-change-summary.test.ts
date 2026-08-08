import { describe, expect, it } from "vitest";

import { deriveTurnFileChangeSummary } from "../file-change-summary";
import { createAcceptedTurnState } from "../turn-reducer";

describe("deriveTurnFileChangeSummary", () => {
  it("按逐文件 unified diff 统计增删行并排除文件头", () => {
    const turn = {
      ...createAcceptedTurnState("thread-1", "turn-1"),
      items: [
        {
          type: "fileChange" as const,
          id: "patch-1",
          status: "completed" as const,
          changes: [
            {
              path: "src/app.ts",
              kind: { type: "update" as const, move_path: null },
              diff: [
                "diff --git a/src/app.ts b/src/app.ts",
                "--- a/src/app.ts",
                "+++ b/src/app.ts",
                "@@ -1,2 +1,3 @@",
                " const value = 1;",
                "-const oldValue = 2;",
                "+const nextValue = 2;",
                "+export { nextValue };",
              ].join("\n"),
            },
            {
              path: "src/new.ts",
              kind: { type: "add" as const },
              diff: "export {};\n",
            },
            {
              path: "src/old.ts",
              kind: { type: "delete" as const },
              diff: "const oldValue = 1;\nexport { oldValue };\n",
            },
          ],
        },
      ],
    };

    expect(deriveTurnFileChangeSummary(turn)).toEqual({
      fileCount: 3,
      additions: 3,
      deletions: 3,
      files: [
        expect.objectContaining({ path: "src/app.ts", additions: 2, deletions: 1 }),
        expect.objectContaining({ path: "src/new.ts", additions: 1, deletions: 0 }),
        expect.objectContaining({ path: "src/old.ts", additions: 0, deletions: 2 }),
      ],
      sourceBreadcrumb: "app-server.item/fileChange/patchUpdated",
    });
  });

  it("优先使用实时 patch、忽略失败项并按路径保留最终版本", () => {
    const turn = {
      ...createAcceptedTurnState("thread-1", "turn-1"),
      items: [
        {
          type: "fileChange" as const,
          id: "patch-ok",
          status: "inProgress" as const,
          changes: [],
        },
        {
          type: "fileChange" as const,
          id: "patch-failed",
          status: "failed" as const,
          changes: [{ path: "failed.ts", kind: { type: "delete" as const }, diff: "-failed" }],
        },
      ],
      filePatchChanges: {
        "patch-ok": [
          { path: "same.ts", kind: { type: "update" as const, move_path: null }, diff: "-old\n+new" },
          { path: "same.ts", kind: { type: "update" as const, move_path: null }, diff: "+final" },
        ],
      },
    };

    expect(deriveTurnFileChangeSummary(turn)).toMatchObject({
      fileCount: 1,
      additions: 1,
      deletions: 0,
      files: [{ path: "same.ts", additions: 1, deletions: 0 }],
    });
  });

  it("没有成功的文件变更时返回 null", () => {
    expect(deriveTurnFileChangeSummary(createAcceptedTurnState("thread-1", "turn-1"))).toBeNull();
  });
});
