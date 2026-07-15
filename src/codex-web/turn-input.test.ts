import { describe, expect, it } from "vitest";

import type { FileAttachment } from "@/types";
import { buildAppServerTurnInput } from "./turn-input";

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
      attachment({ filePath: "/tmp/image.png" }),
    ])).toEqual([
      { type: "image", url: "data:image/png;base64,AAAA" },
      { type: "text", text: "检查图片", text_elements: [] },
    ]);
  });

  it("缺少图片数据时退回 localImage", () => {
    expect(buildAppServerTurnInput("检查图片", [
      attachment({ data: "", filePath: "/tmp/image.png" }),
    ])).toEqual([
      { type: "localImage", path: "/tmp/image.png" },
      { type: "text", text: "检查图片", text_elements: [] },
    ]);
  });

  it("过滤普通文件和无有效载荷的图片", () => {
    expect(buildAppServerTurnInput("只发送文本", [
      attachment({ name: "notes.txt", type: "text/plain" }),
      attachment({ id: "file-2", data: "", filePath: undefined }),
    ])).toEqual([
      { type: "text", text: "只发送文本", text_elements: [] },
    ]);
  });
});
