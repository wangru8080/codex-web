import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("全局搜索 app-server 接线", () => {
  const dialog = readFileSync(
    resolve(process.cwd(), "src/components/layout/GlobalSearchDialog.tsx"),
    "utf8",
  );
  const zh = readFileSync(resolve(process.cwd(), "src/i18n/zh.ts"), "utf8");

  it("会话与文件分别使用官方 app-server action", () => {
    expect(dialog).toContain("useAppServerActions");
    expect(dialog).toContain("listThreads(buildGlobalThreadSearchParams(term))");
    expect(dialog).toContain("fuzzyFileSearch({");
    expect(dialog).toContain("buildGlobalFileSearchRoots");
  });

  it("不再调用不存在的聚合 REST 搜索接口", () => {
    expect(dialog).not.toContain("/api/search");
    expect(dialog).not.toContain("fetch(");
  });

  it("历史消息全文搜索明确标记为不支持且不伪造结果", () => {
    expect(dialog).toContain("const searchesMessages = activeScope === 'all' || activeScope === 'messages'");
    expect(dialog).toContain("globalSearch.messagesUnsupported");
    expect(dialog).not.toContain("SearchResultMessage");
    expect(zh).toContain("'globalSearch.messagesUnsupported'");
    expect(zh).toContain("app-server 暂不提供历史消息全文搜索接口");
  });

  it("消息范围和空文件根目录是受控反例", () => {
    expect(dialog).toContain("if (!searchesSessions && !searchesFiles)");
    expect(dialog).toContain("fileSearchRoots.length > 0");
    expect(dialog).toContain("globalSearch.noFileRoots");
  });

  it("异步查询使用序号阻止旧结果覆盖新查询", () => {
    expect(dialog).toContain("searchSequenceRef.current += 1");
    expect(dialog).toContain("if (sequence !== searchSequenceRef.current) return");
    expect(dialog).toContain("cancellationToken: 'global-search-dialog'");
  });
});
