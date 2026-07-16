import { describe, expect, it } from "vitest";

import type { FileAttachment } from "@/types";
import { buildAppServerTurnInput } from "./turn-input";
import { buildFileExcerptPrompt } from "@/lib/file-excerpt-reference";

function attachment(overrides: Partial<FileAttachment> = {}): FileAttachment {
  return {
    id: "file-1",
    name: "image.png",
    type: "image/png",
    size: 4,
    data: "AAAA",
    ...overrides,
  };
}

describe("buildAppServerTurnInput", () => {
  it("把文件片段路径、行号和正文原样写入 app-server 文本输入", () => {
    const prompt = buildFileExcerptPrompt("这是 UTC 时间吗？", [{
      id: "excerpt-1",
      path: "/repo/scripts/run_rsync.sh",
      name: "run_rsync.sh",
      text: "date -u\ndate",
      startLine: 4,
      endLine: 5,
    }]);

    expect(buildAppServerTurnInput(prompt)).toEqual([{ type: "text", text: prompt, text_elements: [] }]);
  });

  it("无附件时只生成官方 text block", () => {
    expect(buildAppServerTurnInput("检查项目")).toEqual([
      { type: "text", text: "检查项目", text_elements: [] },
    ]);
  });

  it("把浏览器图片数据放在文本前并生成 image block", () => {
    expect(buildAppServerTurnInput("检查图片", [attachment()])).toEqual([
      { type: "image", url: "data:image/png;base64,AAAA" },
      { type: "text", text: "检查图片", text_elements: [] },
    ]);
  });

  it("即使存在本地路径也优先使用 data URL 以兼容 SSH app-server", () => {
    expect(buildAppServerTurnInput("检查图片", [
      attachment({ filePath: "/codex-home/attachments/id/image.png" }),
    ])).toEqual([
      { type: "image", url: "data:image/png;base64,AAAA" },
      {
        type: "text",
        text: "\n# Files mentioned by the user:\n\n## image.png: /codex-home/attachments/id/image.png\n\n## My request for Codex:\n检查图片\n",
        text_elements: [],
      },
    ]);
  });

  it("缺少图片数据时退回 localImage", () => {
    expect(buildAppServerTurnInput("检查图片", [
      attachment({ data: "", filePath: "/codex-home/attachments/id/image.png" }),
    ])).toEqual([
      { type: "localImage", path: "/codex-home/attachments/id/image.png" },
      {
        type: "text",
        text: "\n# Files mentioned by the user:\n\n## image.png: /codex-home/attachments/id/image.png\n\n## My request for Codex:\n检查图片\n",
        text_elements: [],
      },
    ]);
  });

  it("按官方 App 文本信封传入普通文件绝对路径", () => {
    expect(buildAppServerTurnInput("总结文件", [attachment({
      name: "notes.md",
      type: "text/markdown",
      data: "IyBOb3Rlcw==",
      filePath: "/codex-home/attachments/id/notes.md",
    })])).toEqual([{
      type: "text",
      text: "\n# Files mentioned by the user:\n\n## notes.md: /codex-home/attachments/id/notes.md\n\n## My request for Codex:\n总结文件\n",
      text_elements: [],
    }]);
  });

  it("项目 originPath 文件不进入上传附件信封", () => {
    expect(buildAppServerTurnInput("检查 @README.md", [
      attachment({
        name: "README.md",
        type: "text/markdown",
        filePath: "/codex-home/attachments/id/README.md",
        originPath: "README.md",
      }),
      attachment({
        id: "directory",
        name: "docs",
        type: "inode/directory",
        data: "",
        filePath: "/repo/docs",
      }),
    ])).toEqual([
      { type: "text", text: "检查 @README.md", text_elements: [] },
    ]);
  });

  it("过滤未持久化普通文件和无有效载荷的图片", () => {
    expect(buildAppServerTurnInput("只发送文本", [
      attachment({ name: "notes.txt", type: "text/plain" }),
      attachment({ id: "file-2", data: "", filePath: undefined }),
    ])).toEqual([
      { type: "text", text: "只发送文本", text_elements: [] },
    ]);
  });
});
