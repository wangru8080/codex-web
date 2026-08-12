import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("app-server 输出媒体接线", () => {
  it("通过 fs/readFile 加载本地图片，不再请求遗留 media API", () => {
    const preview = readFileSync(
      resolve(process.cwd(), "src/components/chat/MediaPreview.tsx"),
      "utf8",
    );

    expect(preview).toContain("useAppServerActions");
    expect(preview).toContain("getCachedMediaObjectUrl(path, readFile)");
    expect(preview).not.toContain("/api/media/serve");
  });

  it("保留加载中与失败状态，避免图片区域静默消失", () => {
    const preview = readFileSync(
      resolve(process.cwd(), "src/components/chat/MediaPreview.tsx"),
      "utf8",
    );

    expect(preview).toContain("media.outputLoading");
    expect(preview).toContain("media.outputLoadFailed");
  });

  it("Markdown 本地绝对路径通过 app-server 读取后转成 Blob URL", () => {
    const markdown = readFileSync(
      resolve(process.cwd(), "src/components/chat/markdown-components.tsx"),
      "utf8",
    );
    expect(markdown).toContain("getCachedMediaObjectUrl(path, readFile)");
    expect(markdown).toContain("resolveToolPath(source.replace(/^\\.[/\\\\]/, \"\"), baseDirectory ?? workingDirectory)");
    expect(markdown).toContain("图片加载失败，请检查文件后重试");
  });

  it("用户消息中的路径型图片通过 app-server 读取后显示缩略图", () => {
    const attachments = readFileSync(
      resolve(process.cwd(), "src/components/chat/FileAttachmentDisplay.tsx"),
      "utf8",
    );

    expect(attachments).toContain("getCachedMediaObjectUrl(path, readFile)");
    expect(attachments).toContain("fileUrl(f, pathUrls)");
    expect(attachments).toContain("!fileUrl(f, pathUrls)");
  });

  it("图片灯箱提供可访问性描述", () => {
    const lightbox = readFileSync(
      resolve(process.cwd(), "src/components/chat/ImageLightbox.tsx"),
      "utf8",
    );

    expect(lightbox).toContain("DialogDescription");
    expect(lightbox).toContain("{current.alt}");
  });

  it("新 app-server turn 发送前清空媒体缓存", () => {
    const chatView = readFileSync(
      resolve(process.cwd(), "src/components/chat/ChatView.tsx"),
      "utf8",
    );
    expect(chatView).toContain("clearAllCachedMediaObjectUrls();");
  });
});
