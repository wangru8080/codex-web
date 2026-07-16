import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("用户消息文件片段展示接线", () => {
  const item = readFileSync(resolve(process.cwd(), "src/components/chat/MessageItem.tsx"), "utf8");
  const display = readFileSync(resolve(process.cwd(), "src/components/chat/FileExcerptDisplay.tsx"), "utf8");
  const history = readFileSync(resolve(process.cwd(), "src/codex-web/thread-history-adapter.ts"), "utf8");

  it("MessageItem 解析片段元数据并在问题正文前渲染", () => {
    expect(item).toContain("parseFileExcerptDisplay");
    expect(item).toContain("<FileExcerptDisplay references={fileExcerpts}");
    expect(item.indexOf("<FileExcerptDisplay references={fileExcerpts}")).toBeLessThan(
      item.indexOf("{/* Text content */}"),
    );
  });

  it("片段展示包含文件名和起止行，不渲染片段正文", () => {
    expect(display).toContain("reference.name");
    expect(display).toContain("reference.startLine");
    expect(display).toContain("reference.endLine");
    expect(display).not.toContain("reference.text");
  });

  it("app-server 历史适配器把模型提示词恢复成展示元数据", () => {
    expect(history).toContain("parseFileExcerptPrompt");
    expect(history).toContain("encodeFileExcerptDisplay");
  });
});
