import { describe, expect, it } from "vitest";

import {
  directoryChildren,
  directoryCompletionQuery,
  directoryParent,
  joinDirectoryPath,
  matchingDirectories,
} from "../directory-browser-adapter";

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

  it("从 POSIX 和 Windows 输入中拆分补全父目录与片段", () => {
    expect(directoryCompletionQuery("/volume2/SSD/co", "/workspace")).toEqual({
      parentPath: "/volume2/SSD",
      fragment: "co",
    });
    expect(directoryCompletionQuery("C:\\Users\\co", "C:\\workspace")).toEqual({
      parentPath: "C:\\Users",
      fragment: "co",
    });
  });

  it("相对片段使用当前目录作为补全父目录", () => {
    expect(directoryCompletionQuery("co", "/workspace")).toEqual({
      parentPath: "/workspace",
      fragment: "co",
    });
  });

  it("只返回大小写不敏感的目录前缀匹配", () => {
    expect(matchingDirectories("/volume2/SSD/co", "/workspace", [
      { fileName: "Config.txt", isDirectory: false, isFile: true },
      { fileName: "codex", isDirectory: true, isFile: false },
      { fileName: "Code", isDirectory: true, isFile: false },
      { fileName: "data", isDirectory: true, isFile: false },
    ])).toEqual([
      { name: "Code", path: "/volume2/SSD/Code" },
      { name: "codex", path: "/volume2/SSD/codex" },
    ]);
  });
});
