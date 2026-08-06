import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function read(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), "utf8");
}

describe("goal reopen hydration wiring", () => {
  it("历史会话 resume 后通过 thread/goal/get 恢复 route 和 resumed thread 的目标", () => {
    const page = read("src/app/chat/[id]/page.tsx");
    expect(page).toContain("getThreadGoal");
    expect(page).toContain("Promise.allSettled");
    expect(page).toContain("Array.from(new Set([id, resume.thread.id]))");
    expect(page).toContain("getThreadGoal(threadId)");
  });

  it("分屏会话 reopen 后也恢复目标状态", () => {
    const splitColumn = read("src/components/layout/SplitColumn.tsx");
    expect(splitColumn).toContain("Promise.allSettled");
    expect(splitColumn).toContain("Array.from(new Set([sessionId, resumed.thread.id]))");
    expect(splitColumn).toContain("getThreadGoal(threadId)");
  });
});
