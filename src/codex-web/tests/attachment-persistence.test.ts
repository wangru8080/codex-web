import { describe, expect, it, vi } from "vitest";

import type { FileAttachment } from "@/types";

import { persistAttachments } from "../attachment-persistence";

function attachment(overrides: Partial<FileAttachment> = {}): FileAttachment {
  return {
    id: "image-1",
    name: "screen.png",
    type: "image/png",
    size: 4,
    data: "AAAA",
    ...overrides,
  };
}

describe("persistAttachments", () => {
  it("通过 app-server fs 接口写入 CODEX_HOME/attachments UUID 目录", async () => {
    const request = vi.fn(async (_method: string, _params?: unknown) => ({}));

    const result = await persistAttachments({
      files: [attachment()],
      codexHome: "/codex-home",
      platformFamily: "unix",
      request,
      createId: () => "attachment-uuid",
    });

    expect(request.mock.calls).toEqual([
      ["fs/createDirectory", {
        path: "/codex-home/attachments/attachment-uuid",
        recursive: true,
      }],
      ["fs/writeFile", {
        path: "/codex-home/attachments/attachment-uuid/screen.png",
        dataBase64: "AAAA",
      }],
    ]);
    expect(result).toEqual([
      expect.objectContaining({
        name: "screen.png",
        data: "AAAA",
        filePath: "/codex-home/attachments/attachment-uuid/screen.png",
      }),
    ]);
  });

  it("净化路径型文件名并使用 Windows 路径分隔符", async () => {
    const request = vi.fn(async (_method: string, _params?: unknown) => ({}));

    const result = await persistAttachments({
      files: [attachment({ name: "../shots\\capture?.png" })],
      codexHome: "C:\\Users\\tester\\.codex\\",
      platformFamily: "windows",
      request,
      createId: () => "attachment-uuid",
    });

    expect(request.mock.calls[0]?.[1]).toEqual({
      path: "C:\\Users\\tester\\.codex\\attachments\\attachment-uuid",
      recursive: true,
    });
    expect(request.mock.calls[1]?.[1]).toEqual({
      path: "C:\\Users\\tester\\.codex\\attachments\\attachment-uuid\\capture_.png",
      dataBase64: "AAAA",
    });
    expect(result[0]?.filePath).toBe(
      "C:\\Users\\tester\\.codex\\attachments\\attachment-uuid\\capture_.png",
    );
  });

  it("把普通 Markdown 文件写入独立 UUID 目录", async () => {
    const request = vi.fn(async (_method: string, _params?: unknown) => ({}));

    const result = await persistAttachments({
      files: [attachment({
        id: "document-1",
        name: "notes.md",
        type: "text/markdown",
        size: 7,
        data: "IyBOb3Rlcw==",
      })],
      codexHome: "/codex-home",
      platformFamily: "unix",
      request,
      createId: () => "file-uuid",
    });

    expect(request.mock.calls).toEqual([
      ["fs/createDirectory", {
        path: "/codex-home/attachments/file-uuid",
        recursive: true,
      }],
      ["fs/writeFile", {
        path: "/codex-home/attachments/file-uuid/notes.md",
        dataBase64: "IyBOb3Rlcw==",
      }],
    ]);
    expect(result[0]?.filePath).toBe("/codex-home/attachments/file-uuid/notes.md");
  });

  it("忽略没有数据、已持久化和带 originPath 的项目文件", async () => {
    const request = vi.fn(async (_method: string, _params?: unknown) => ({}));
    const files = [
      attachment({ id: "empty", data: "", filePath: "/existing/image.png" }),
      attachment({ id: "persisted", filePath: "/codex-home/attachments/id/image.png" }),
      attachment({
        id: "project-file",
        name: "README.md",
        type: "text/markdown",
        originPath: "README.md",
      }),
    ];

    const result = await persistAttachments({
      files,
      codexHome: "/codex-home",
      platformFamily: "unix",
      request,
      createId: () => "unused",
    });

    expect(request).not.toHaveBeenCalled();
    expect(result).toEqual(files);
  });

  it("写入失败时返回包含附件名的错误", async () => {
    const request = vi
      .fn(async (_method: string, _params?: unknown) => ({}))
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error("disk full"));

    await expect(persistAttachments({
      files: [attachment()],
      codexHome: "/codex-home",
      platformFamily: "unix",
      request,
      createId: () => "attachment-uuid",
    })).rejects.toThrow("无法保存附件 screen.png: disk full");
  });
});
