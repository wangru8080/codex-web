import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("文件树引用胶囊接线", () => {
  const input = readFileSync(resolve(process.cwd(), "src/components/chat/MessageInput.tsx"), "utf8");
  const parts = readFileSync(resolve(process.cwd(), "src/components/chat/MessageInputParts.tsx"), "utf8");

  it("独立监听文件引用，不向 textarea 写入 @路径", () => {
    expect(input).toContain("'insert-file-reference'");
    expect(input).toContain("setFileReferencePaths");
    expect(input).toContain("<FileReferenceCapsules");
    expect(input).toContain("onFileReferenceSelected");
  });

  it("文件引用以文件卡片展示并可移除", () => {
    expect(parts).toContain("export function FileReferenceCapsules");
    expect(parts).toContain("path.split(/[\\\\/]/).pop()");
  });

  it("发送时合并结构化文件 mention，并在失败时恢复", () => {
    expect(input).toContain("fileReferenceMentions");
    expect(input).toContain("fileReferencePaths,");
    expect(input).toContain("restoreFileRefs");
    expect(input).toContain("setFileReferencePaths([])");
    expect(input).not.toContain("fileNotes.push");
  });
});
