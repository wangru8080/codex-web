import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function source(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

describe("app-server image attachment wiring", () => {
  it("AppServerProvider 使用共享构造器生成 turn/start.input", () => {
    const provider = source("../AppServerProvider.tsx");

    expect(provider).toContain("persistAttachments");
    expect(provider).toContain("buildAppServerTurnInput(trimmed, persistedFiles, skills)");
    expect(provider).not.toContain('file.type.startsWith("image/") && !!file.data');
    expect(provider.match(/if \(!trimmed && !files\?\.length\)/g)?.length).toBe(2);
    expect(provider.match(/files\?: readonly FileAttachment\[\]/g)?.length).toBe(2);
    expect(provider).toContain("sendTurnInThread({ threadId, content: trimmed, files: persistedFiles,");
  });

  it("新会话向新建和续接线程路径都传入 files", () => {
    const page = source("../../app/chat/page.tsx");

    expect(page).toMatch(/sendTurnInThread\(\{[\s\S]*?threadId: existingThreadId,[\s\S]*?content,[\s\S]*?files,/);
    expect(page).toMatch(/sendOneTurn\(\{[\s\S]*?content,[\s\S]*?files,/);
  });

  it("历史会话不再拒绝附件并向 appServerSend 传入 files", () => {
    const chatView = source("../../components/chat/ChatView.tsx");
    const historyPage = source("../../app/chat/[id]/page.tsx");

    expect(chatView).not.toContain("app-server 历史恢复发送暂不支持附件");
    expect(chatView).toMatch(/appServerSend\(\{[\s\S]*?content: trimmed,[\s\S]*?files,/);
    expect(historyPage).toContain("async ({ content, files, cwd, model, effort, mode, permissionProfile, onAccepted })");
    expect(historyPage).toMatch(/sendTurnInThread\(\{[\s\S]*?threadId,[\s\S]*?content,[\s\S]*?files,/);
  });

  it("Codex 输入框允许普通上传文件但项目树普通文件保持 @路径", () => {
    const messageInput = source("../../components/chat/MessageInput.tsx");
    const messageInputParts = source("../../components/chat/MessageInputParts.tsx");
    const chatView = source("../../components/chat/ChatView.tsx");

    expect(messageInput).toContain("const resolvedAttachmentsAccept = attachmentsAccept ?? ''");
    expect(messageInput).toContain("accept={resolvedAttachmentsAccept}");
    expect(chatView).not.toContain("attachmentsAccept={appServerSend ? 'image/*' : undefined}");
    expect(messageInput).toContain("<FileTreeAttachmentBridge imageOnly={codexOnly} />");
    expect(messageInput).toContain("<FileAndFolderMenuItem />");
    expect(messageInputParts).toContain("if (imageOnly && !contentType.startsWith('image/'))");
    expect(messageInputParts).toContain("new CustomEvent('insert-file-mention', { detail: { path: filePath } })");
  });

  it("附件转换失败时不得静默发送纯文本", () => {
    const messageInput = source("../../components/chat/MessageInput.tsx");

    expect(messageInput).toContain("throw new Error(`无法读取附件 ${file.filename || 'file'}: ${message}`)");
    expect(messageInput).not.toContain("// Skip files that fail conversion");
  });
});
