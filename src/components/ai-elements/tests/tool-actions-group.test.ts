import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../tool-actions-group.tsx", import.meta.url), "utf8");

describe("工具过程折叠组", () => {
  it("不依赖不存在的 StickToBottom 上下文", () => {
    expect(source).not.toContain("useStickToBottomContext");
  });
});
