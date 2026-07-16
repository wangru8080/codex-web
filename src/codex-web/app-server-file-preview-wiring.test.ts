import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("app-server 文件预览接线", () => {
  const provider = readFileSync(resolve(process.cwd(), "src/codex-web/AppServerProvider.tsx"), "utf8");
  const preview = readFileSync(resolve(process.cwd(), "src/components/layout/panels/PreviewPanel.tsx"), "utf8");

  it("Provider 公开 generated fs/readFile 与 fs/writeFile", () => {
    expect(provider).toContain('client.request("fs/readFile"');
    expect(provider).toContain('client.request("fs/writeFile"');
  });

  it("预览和保存不再调用缺失的 Next 文件 API", () => {
    expect(preview).toContain("filePreviewFromResponse");
    expect(preview).toContain("fileDataUrlFromResponse");
    expect(preview).not.toContain('const res = await fetch(\n          `/api/files/preview');
    expect(preview).not.toContain('fetch("/api/files/write"');
  });
});
