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

  it("使用官方样式的复制和续接图标", () => {
    expect(source).toContain("<Copy size={12} aria-hidden />");
    expect(source).toContain("<ArrowsSplit size={13} style={{ transform: 'rotate(-90deg)' }} />");
    expect(source).not.toContain('<CodexWebIcon name="copy"');
    expect(source).not.toContain("<GitBranch size={13}");
    expect(source).not.toContain("<ArrowElbowDownRight size={13}");
  });

  it("创建新任务失败时显示错误且恢复按钮状态", () => {
    expect(source).toContain("catch { showToast({ type: 'error', message: t('error.sessionCreateFailed' as TranslationKey) }); }");
    expect(source).toContain("finally { setIsForking(false); }");
  });

  it("只有带真实 turn_id 的助手消息才显示续接按钮", () => {
    expect(source).toContain("!isUser && message.turn_id && onContinueInNewTask");
  });
});
