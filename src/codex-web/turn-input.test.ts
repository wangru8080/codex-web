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
  it("为试用技能发送官方 text marker 与结构化 skill input", () => {
    expect(buildAppServerTurnInput("[$imagegen](/codex-home/skills/imagegen/SKILL.md) 生成图片", [], [{
      name: "imagegen",
      path: "/codex-home/skills/imagegen/SKILL.md",
    }])).toEqual([
      { type: "text", text: "[$imagegen](/codex-home/skills/imagegen/SKILL.md) 生成图片", text_elements: [] },
      { type: "skill", name: "imagegen", path: "/codex-home/skills/imagegen/SKILL.md" },
    ]);
  });

  it("缺少 path 的旧 Skill tag 只保留 marker，不伪造结构化 skill input", () => {
    expect(buildAppServerTurnInput("$legacy 执行", [], [{ name: "legacy" }])).toEqual([
      { type: "text", text: "$legacy 执行", text_elements: [] },
    ]);
  });

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

  it("未持久化图片不伪造官方附件路径", () => {
    expect(buildAppServerTurnInput("检查图片", [attachment()])).toEqual([
      { type: "text", text: "检查图片", text_elements: [] },
    ]);
  });

  it("持久化图片只使用官方文件信封而不重复发送 image block", () => {
    expect(buildAppServerTurnInput("检查图片", [
      attachment({ filePath: "/codex-home/attachments/id/image.png" }),
    ])).toEqual([
      {
        type: "text",
        text: "\n# Files mentioned by the user:\n\n## image.png: /codex-home/attachments/id/image.png\n\n## My request for Codex:\n检查图片\n",
        text_elements: [],
      },
    ]);
  });

  it("缺少图片数据时仍只通过持久化路径引用图片", () => {
    expect(buildAppServerTurnInput("检查图片", [
      attachment({ data: "", filePath: "/codex-home/attachments/id/image.png" }),
    ])).toEqual([
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

  it("逐字生成官方 session 使用的相对 CSV 附件信封", () => {
    expect(buildAppServerTurnInput("这个文档包含了什么内容", [attachment({
      name: "jay_chou_original_songs_20260605_simplified.csv",
      type: "text/csv",
      data: "Y29udGVudA==",
      filePath: "data/jay_chou_original_songs_20260605_simplified.csv",
    })])).toEqual([{
      type: "text",
      text: "\n# Files mentioned by the user:\n\n## jay_chou_original_songs_20260605_simplified.csv: data/jay_chou_original_songs_20260605_simplified.csv\n\n## My request for Codex:\n这个文档包含了什么内容\n",
      text_elements: [],
    }]);
  });

  it("逐字生成官方 session 使用的相对 PNG 附件信封", () => {
    expect(buildAppServerTurnInput("理解图片", [attachment({
      name: "baidu_luoyang_moly_first_result_20260624.png",
      filePath: "data/baidu_luoyang_moly_first_result_20260624.png",
    })])).toEqual([{
      type: "text",
      text: "\n# Files mentioned by the user:\n\n## baidu_luoyang_moly_first_result_20260624.png: data/baidu_luoyang_moly_first_result_20260624.png\n\n## My request for Codex:\n理解图片\n",
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

  it("@ 工作区文件按官方 Markdown 链接原样进入 text input", () => {
    const prompt = "[AGENTS.md](AGENTS.md) 描述这个文件的主要内容";
    const input = buildAppServerTurnInput(prompt);

    expect(input).toEqual([{ type: "text", text: prompt, text_elements: [] }]);
    expect(input[0]?.type === "text" ? input[0].text : "").not.toContain("@AGENTS.md");
    expect(input[0]?.type === "text" ? input[0].text : "").not.toContain("[Referenced Files]");
    expect(input[0]?.type === "text" ? input[0].text : "").not.toContain("# Files mentioned by the user");
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
