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
    expect(preview).toContain("readFile(path)");
    expect(preview).toContain("fileDataUrlFromResponse(path, response)");
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

  it("图片灯箱提供可访问性描述", () => {
    const lightbox = readFileSync(
      resolve(process.cwd(), "src/components/chat/ImageLightbox.tsx"),
      "utf8",
    );

    expect(lightbox).toContain("DialogDescription");
    expect(lightbox).toContain("{current.alt}");
  });
});
