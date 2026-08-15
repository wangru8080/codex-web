import { describe, expect, it, vi } from "vitest";

import {
  classifyPath,
  workspacePathRequiresConfirmation,
  workspacePathsToInspect,
} from "../preview-source";

describe("预览路径信任边界", () => {
  it("规范化父目录后拒绝逃逸工作区的路径", () => {
    expect(classifyPath("/workspace/../private/secret.txt", "/workspace")).toEqual({
      trust: "agent-referenced",
      readonly: true,
    });
    expect(classifyPath("C:\\workspace\\..\\private\\secret.txt", "C:\\workspace")).toEqual({
      trust: "agent-referenced",
      readonly: true,
    });
  });

  it("不会把相似目录前缀当作工作区子目录", () => {
    expect(classifyPath("/workspace-copy/file.ts", "/workspace").trust).toBe("agent-referenced");
  });

  it("列出工作区下需要检查的每一级路径", () => {
    expect(workspacePathsToInspect("/workspace/src/lib/file.ts", "/workspace")).toEqual([
      "/workspace/src",
      "/workspace/src/lib",
      "/workspace/src/lib/file.ts",
    ]);
  });

  it("工作区内任一级为软链接时要求用户确认", async () => {
    const getMetadata = vi.fn(async (path: string) => ({
      isDirectory: path !== "/workspace/link/file.ts",
      isFile: path === "/workspace/link/file.ts",
      isSymlink: path === "/workspace/link",
      createdAtMs: 0,
      modifiedAtMs: 0,
    }));

    await expect(workspacePathRequiresConfirmation(
      "/workspace/link/file.ts",
      "/workspace",
      getMetadata,
    )).resolves.toBe(true);
    expect(getMetadata).toHaveBeenCalledTimes(1);
  });

  it("普通工作区文件保持自动读取", async () => {
    await expect(workspacePathRequiresConfirmation(
      "/workspace/src/file.ts",
      "/workspace",
      async () => ({
        isDirectory: false,
        isFile: true,
        isSymlink: false,
        createdAtMs: 0,
        modifiedAtMs: 0,
      }),
    )).resolves.toBe(false);
  });
});
