import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("活动 writer 恢复收口", () => {
  it("冲突时读取完整历史并进入只读回放，不声称实时同步", () => {
    const source = readFileSync(resolve(process.cwd(), "src/app/chat/[id]/page.tsx"), "utf8");
    expect(source).toContain("already has an active writer");
    expect(source).toContain("readThread(id, { includeTurns: true })");
    expect(source).toContain("setActiveWriterReplayOnly(true)");
    expect(source).toContain("readOnly={activeWriterReplayOnly || (!isAppServerThread && sessionReadOnly)}");
    expect(source).not.toContain("实时状态将继续同步");
  });
});
