import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("create-long-history-fixture 路径边界", () => {
  it("使用执行时工作目录，不绑定源码仓库绝对路径", () => {
    const source = readFileSync(
      resolve(process.cwd(), "scripts/create-long-history-fixture.ts"),
      "utf8",
    );

    expect(source).toContain("const cwd = process.cwd();");
    expect(source).not.toContain("/home/rrssnas/code/codex/web");
  });
});
