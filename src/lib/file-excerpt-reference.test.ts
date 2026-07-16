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

  it("把内联代码、强调和链接的可见文本映射回 Markdown 源行", () => {
    const source = [
      "# 配置",
      "",
      "- 使用 `model/list` 读取 **模型列表** 和 [官方文档](https://example.com/docs)。",
      "- 下一项。",
    ].join("\n");

    expect(locateExcerptLines(
      source,
      "使用 model/list 读取 模型列表 和 官方文档。",
    )).toEqual({ startLine: 3, endLine: 3 });
  });
});

describe("文件片段双通道协议", () => {
  it("模型提示词包含路径、行号、完整选区和用户问题", () => {
    const prompt = buildFileExcerptPrompt("这是 UTC 时间吗？", [reference]);

    expect(prompt).toBe(
      "\n# Selected text:\n\n"
      + "## Selection 1: /workspace/scripts/run_rsync.sh (lines 4-5)\n"
      + "date -u\ndate\n\n"
      + "## My request for Codex:\n"
      + "这是 UTC 时间吗？\n",
    );
    expect(parseFileExcerptPrompt(prompt)).toEqual({
      references: [reference],
      request: "这是 UTC 时间吗？",
    });
  });

  it("单行与多片段使用官方编号和 line/lines 拼写", () => {
    const second = {
      ...reference,
      id: "excerpt-2",
      path: "/volume2/SSD/codex/Chat/AGENTS.md",
      name: "AGENTS.md",
      text: "若用户未指定路径，则所有通过网络下载的文件，以及执行过程中产生的临时文件、临时日志、中间产物、缓存文件、图片等，统一放入：",
      startLine: 5,
      endLine: 5,
    };

    expect(buildFileExcerptPrompt("这是什么意思", [second, reference])).toBe(
      "\n# Selected text:\n\n"
      + "## Selection 1: /volume2/SSD/codex/Chat/AGENTS.md (line 5)\n"
      + "若用户未指定路径，则所有通过网络下载的文件，以及执行过程中产生的临时文件、临时日志、中间产物、缓存文件、图片等，统一放入：\n\n"
      + "## Selection 2: /workspace/scripts/run_rsync.sh (lines 4-5)\n"
      + "date -u\ndate\n\n"
      + "## My request for Codex:\n"
      + "这是什么意思\n",
    );

    expect(parseFileExcerptPrompt(buildFileExcerptPrompt("这是什么意思", [second, reference]))).toEqual({
      references: [
        { ...second, id: "excerpt-1" },
        { ...reference, id: "excerpt-2" },
      ],
      request: "这是什么意思",
    });
  });

  it("无法确定行号时保留官方 Selection 路径和正文但不伪造行号", () => {
    const withoutLines = {
      ...reference,
      startLine: undefined,
      endLine: undefined,
    };

    expect(buildFileExcerptPrompt("解释片段", [withoutLines])).toBe(
      "\n# Selected text:\n\n"
      + "## Selection 1: /workspace/scripts/run_rsync.sh\n"
      + "date -u\ndate\n\n"
      + "## My request for Codex:\n"
      + "解释片段\n",
    );
  });

  it("仍能解析已发送的旧私有片段提示词", () => {
    const legacyPrompt = `[CODEX_WEB_FILE_EXCERPTS_V1]\n${JSON.stringify([reference], null, 2)}\n[/CODEX_WEB_FILE_EXCERPTS_V1]\n\n这是 UTC 时间吗？`;

    expect(parseFileExcerptPrompt(legacyPrompt)).toEqual({
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
