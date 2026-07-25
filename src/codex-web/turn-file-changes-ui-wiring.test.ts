import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("Turn 文件变更 UI 接线", () => {
  const chatView = read("src/components/chat/ChatView.tsx");
  const messageInput = read("src/components/chat/MessageInput.tsx");
  const composerChanges = read("src/components/chat/ComposerFileChanges.tsx");
  const summary = read("src/codex-web/file-change-summary.ts");

  it("从 app-server Turn 派生摘要并传入输入框", () => {
    expect(chatView).toContain("deriveTurnFileChangeSummary(presentedAppServerTurn ?? null)");
    expect(chatView).toContain("fileChangeSummary={appServerSend ? appServerFileChangeSummary : null}");
    expect(messageInput).toContain("<ComposerFileChanges summary={fileChangeSummary ?? null} />");
  });

  it("逐文件点击复用右侧 inline-diff 预览", () => {
    expect(composerChanges).toContain("data-testid=\"composer-file-changes\"");
    expect(composerChanges).toContain("kind: 'inline-diff'");
    expect(composerChanges).toContain("diff: file.diff");
    expect(composerChanges).toContain("if (!summary) return null");
  });

  it("文件变更事实不依赖 Git", () => {
    expect(summary.toLowerCase()).not.toContain("git");
    expect(summary).toContain("app-server.item/fileChange/patchUpdated");
  });
});
