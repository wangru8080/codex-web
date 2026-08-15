import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("输入框命令、技能与文件接线", () => {
  it("把新对话创建后的真实线程 ID 传给输入框", () => {
    const page = source("src/app/chat/page.tsx");
    expect(page).toContain("sessionId={createdSessionId}");
  });

  it("通过 app-server 搜索并读取 @ 文件上下文", () => {
    const hook = source("src/hooks/useSlashCommands.ts");
    const input = source("src/components/chat/MessageInput.tsx");

    expect(hook).toContain("fuzzyFileSearch({");
    expect(input).toContain("appServer.readFileLimited(absolutePath, MAX_MENTION_FILE_BYTES)");
    expect(input).toContain("appServer.readDirectory(dir)");
    expect(hook).not.toContain("/api/files/suggest");
    expect(input).not.toContain("/api/files/raw");
    expect(input).not.toContain("/api/files/serve");
  });
});
