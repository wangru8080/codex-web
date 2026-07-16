import { describe, expect, it } from "vitest";

import {
  buildFileExcerptPrompt,
  encodeFileExcerptDisplay,
  locateExcerptLines,
  parseFileExcerptDisplay,
  parseFileExcerptPrompt,
  type FileExcerptReference,
} from "./file-excerpt-reference";

const reference: FileExcerptReference = {
  id: "excerpt-1",
  path: "/workspace/scripts/run_rsync.sh",
  name: "run_rsync.sh",
  text: "date -u\ndate",
  startLine: 4,
  endLine: 5,
};

describe("文件片段行号定位", () => {
  it("计算跨行选区并叠加 frontmatter 行偏移", () => {
    const source = "标题\n第一行\ndate -u\ndate\n结尾";

    expect(locateExcerptLines(source, "date -u\ndate", 2)).toEqual({
      startLine: 5,
      endLine: 6,
    });
  });

  it("兼容 CRLF，并正确处理单行中的部分选区", () => {
    expect(locateExcerptLines("alpha\r\nbeta gamma\r\nomega", "beta", 0)).toEqual({
      startLine: 2,
      endLine: 2,
    });
  });

  it("相同片段出现多次时不伪造行号", () => {
    expect(locateExcerptLines("same\nother\nsame", "same", 0)).toBeNull();
  });

  it("把渲染后的列表纯文本映射回带 Markdown 前缀的源行", () => {
    const source = [
      "范围内：",
      "",
      "- 本地 codex app-server 连接。",
      "- SSH 远程 codex app-server 连接。",
      "- 其他能力。",
    ].join("\n");

    expect(locateExcerptLines(
      source,
      "本地 codex app-server 连接。\nSSH 远程 codex app-server 连接。",
    )).toEqual({ startLine: 3, endLine: 4 });
  });
});

describe("文件片段双通道协议", () => {
  it("模型提示词包含路径、行号、完整选区和用户问题", () => {
    const prompt = buildFileExcerptPrompt("这是 UTC 时间吗？", [reference]);

    expect(prompt).toContain("/workspace/scripts/run_rsync.sh");
    expect(prompt).toContain('"startLine": 4');
    expect(prompt).toContain('"endLine": 5');
    expect(prompt).toContain("date -u\\ndate");
    expect(prompt.endsWith("这是 UTC 时间吗？")).toBe(true);
    expect(parseFileExcerptPrompt(prompt)).toEqual({
      references: [reference],
      request: "这是 UTC 时间吗？",
    });
  });

  it("展示内容仅保存卡片元数据，不复制长片段正文", () => {
    const content = encodeFileExcerptDisplay("这是 UTC 时间吗？", [reference]);

    expect(content).not.toContain("date -u");
    expect(parseFileExcerptDisplay(content)).toEqual({
      references: [{
        id: "excerpt-1",
        path: "/workspace/scripts/run_rsync.sh",
        name: "run_rsync.sh",
        startLine: 4,
        endLine: 5,
      }],
      request: "这是 UTC 时间吗？",
    });
  });

  it("普通消息保持原样", () => {
    expect(parseFileExcerptDisplay("普通问题")).toEqual({ references: [], request: "普通问题" });
    expect(parseFileExcerptPrompt("普通问题")).toEqual({ references: [], request: "普通问题" });
  });
});
