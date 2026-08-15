import { describe, expect, it, vi } from "vitest";

import {
  estimateMentionDirectoryTokens,
  estimateMentionFileTokens,
} from "../useMentionTokenEstimate";

describe("mention Token 估算", () => {
  it("通过 app-server 文件大小估算文件 Token", async () => {
    const getFileSize = vi.fn(async () => 400);

    await expect(estimateMentionFileTokens("src/app.ts", "/workspace", getFileSize))
      .resolves.toBe(100);
    expect(getFileSize).toHaveBeenCalledWith("/workspace/src/app.ts");
  });

  it("通过 app-server 目录条目估算目录摘要 Token", async () => {
    const readDirectory = vi.fn(async () => ({
      entries: [
        { fileName: "src", isDirectory: true, isFile: false },
        { fileName: "README.md", isDirectory: false, isFile: true },
      ],
    }));

    const tokens = await estimateMentionDirectoryTokens("docs", "/workspace", readDirectory);

    expect(tokens).toBeGreaterThan(0);
    expect(readDirectory).toHaveBeenCalledWith("/workspace/docs");
  });

  it("缺少工作目录或 app-server 读取失败时返回空估算", async () => {
    await expect(estimateMentionFileTokens("a.ts", undefined, vi.fn())).resolves.toBeNull();
    await expect(estimateMentionDirectoryTokens(
      "docs",
      "/workspace",
      vi.fn().mockRejectedValue(new Error("不可读")),
    )).resolves.toBeNull();
  });
});
