import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("上下文压缩提示接线", () => {
  it("实时与历史消息都渲染 app-server 压缩过程块", () => {
    const streaming = readFileSync(resolve(process.cwd(), "src/components/chat/StreamingMessage.tsx"), "utf8");
    const history = readFileSync(resolve(process.cwd(), "src/components/chat/MessageItem.tsx"), "utf8");
    const row = readFileSync(resolve(process.cwd(), "src/components/chat/ContextCompactionRow.tsx"), "utf8");

    expect(streaming).toContain("block.type === 'codex_context_compaction'");
    expect(history).toContain("block.type === 'codex_context_compaction'");
    expect(streaming).toContain("<ContextCompactionRow");
    expect(history).toContain("<ContextCompactionRow");
    expect(row).toContain("data-context-compaction-status");
    expect(row).toContain("sourceBreadcrumb");
  });
});
