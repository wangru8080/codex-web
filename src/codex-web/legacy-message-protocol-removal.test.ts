import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("遗留消息协议移除", () => {
  it("历史消息不再解释 Dashboard 和图片生成伪协议", () => {
    const item = source("src/components/chat/MessageItem.tsx");

    for (const token of [
      "show-widget",
      "image-gen-request",
      "image-gen-result",
      "batch-plan",
      "WidgetRenderer",
      "ImageGenConfirmation",
      "ImageGenCard",
      "BatchPlanInlinePreview",
    ]) {
      expect(item).not.toContain(token);
    }
  });

  it("流式消息不再解释 Dashboard 和图片生成伪协议", () => {
    const streaming = source("src/components/chat/StreamingMessage.tsx");

    for (const token of [
      "show-widget",
      "image-gen-request",
      "batch-plan",
      "WidgetRenderer",
      "ImageGenConfirmation",
      "BatchPlanInlinePreview",
    ]) {
      expect(streaming).not.toContain(token);
    }
  });

  it("消息列表不再展示旧 runtime 和定时任务标记", () => {
    const list = source("src/components/chat/MessageList.tsx");
    const chatView = source("src/components/chat/ChatView.tsx");

    expect(list).not.toContain("RuntimeSwitchMarker");
    expect(list).not.toContain("TaskRunMarker");
    expect(list).not.toContain("TaskWaitingForPermissionPanel");
    expect(list).not.toContain("taskRuns");
    expect(chatView).not.toContain("TaskRunSummary");
    expect(chatView).not.toContain("taskRuns");
  });

  it("保留 app-server 过程、计划和媒体展示作为反例", () => {
    const item = source("src/components/chat/MessageItem.tsx");
    const streaming = source("src/components/chat/StreamingMessage.tsx");
    const list = source("src/components/chat/MessageList.tsx");

    expect(item).toContain("ProcessCollapseGroup");
    expect(item).toContain("ProposedPlanMessageBlock");
    expect(item).toContain("UpdatedPlanMessageBlock");
    expect(item).toContain("MediaPreview");
    expect(streaming).toContain("ProcessCollapseGroup");
    expect(streaming).toContain("ProposedPlanMessageBlock");
    expect(streaming).toContain("UpdatedPlanMessageBlock");
    expect(streaming).toContain("MediaPreview");
    expect(list).toContain("processBlocks={processBlocks}");
    expect(list).toContain("planBlocks={planBlocks}");
  });

  it("遗留专用组件已移出生产源码", () => {
    for (const path of [
      "src/components/chat/ImageGenConfirmation.tsx",
      "src/components/chat/ImageGenCard.tsx",
      "src/components/chat/TaskCheckpoint.tsx",
      "src/components/chat/TaskRunMarker.tsx",
      "src/components/chat/TaskWaitingForPermissionPanel.tsx",
      "src/components/chat/RuntimeSwitchMarker.tsx",
      "src/components/project/TaskCard.tsx",
      "src/components/project/TaskList.tsx",
      "src/components/chat/batch-image-gen",
    ]) {
      expect(existsSync(resolve(process.cwd(), path))).toBe(false);
    }
  });
});
