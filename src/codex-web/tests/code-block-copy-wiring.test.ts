import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("代码块复制按钮接线", () => {
  const source = readFileSync(resolve(process.cwd(), "src/components/ai-elements/code-block.tsx"), "utf8");

  it("统一使用剪贴板回退函数", () => {
    expect(source).toContain("writeTextToClipboard(contextCode)");
    expect(source).toContain("writeTextToClipboard(markdown)");
    expect(source).toContain("writeTextToClipboard(code)");
    expect(source).not.toContain("navigator.clipboard.writeText(contextCode)");
    expect(source).not.toContain("navigator.clipboard.writeText(markdown)");
    expect(source).not.toContain("navigator.clipboard.writeText(code)");
  });
});
