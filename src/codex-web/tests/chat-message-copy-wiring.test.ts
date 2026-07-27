import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("聊天消息复制按钮接线", () => {
  const source = readFileSync(resolve(process.cwd(), "src/components/chat/MessageItem.tsx"), "utf8");

  it("使用统一剪贴板函数而不是直接访问 Clipboard API", () => {
    expect(source).toContain("writeTextToClipboard(text)");
    expect(source).not.toContain("navigator.clipboard.writeText(text)");
  });

  it("使用中文可访问名称和提示", () => {
    expect(source).toContain('title="复制"');
    expect(source).toContain('aria-label="复制"');
    expect(source).not.toContain('title="Copy"');
  });
});
