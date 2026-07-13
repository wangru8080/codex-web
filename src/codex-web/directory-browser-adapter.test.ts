import { describe, expect, it } from "vitest";

import { directoryChildren, directoryParent, joinDirectoryPath } from "./directory-browser-adapter";

describe("directory-browser-adapter", () => {
  it("只保留目录并按名称排序", () => {
    expect(directoryChildren("/workspace", [
      { fileName: "zeta", isDirectory: true, isFile: false },
      { fileName: "README.md", isDirectory: false, isFile: true },
      { fileName: "Alpha", isDirectory: true, isFile: false },
    ])).toEqual([
      { name: "Alpha", path: "/workspace/Alpha" },
      { name: "zeta", path: "/workspace/zeta" },
    ]);
  });

  it("计算 POSIX 父目录和子目录", () => {
    expect(directoryParent("/")).toBeNull();
    expect(directoryParent("/home/codex/")).toBe("/home");
    expect(joinDirectoryPath("/", "home")).toBe("/home");
  });

  it("保留 Windows 路径分隔符", () => {
    expect(directoryParent("C:\\Users\\codex")).toBe("C:\\Users");
    expect(directoryParent("C:\\")).toBeNull();
    expect(joinDirectoryPath("C:\\Users", "codex")).toBe("C:\\Users\\codex");
  });
});
