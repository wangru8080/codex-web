import { describe, expect, it } from "vitest";

import { formatToolDisplayOutput, TOOL_OUTPUT_DISPLAY_BYTE_LIMIT } from "./tool-output-display";

describe("formatToolDisplayOutput", () => {
  it("短输出原样返回", () => {
    expect(formatToolDisplayOutput("ok\n")).toBe("ok\n");
  });

  it("长输出按官方 1 MiB 前缀上限截断并显示提示", () => {
    const input = `A${"x".repeat(TOOL_OUTPUT_DISPLAY_BYTE_LIMIT + 1000)}Z`;

    const result = formatToolDisplayOutput(input, { sourceLabel: "app-server 原始 item" });

    expect(result).toMatch(/^A/);
    expect(result).not.toMatch(/Z$/);
    expect(result).toContain("已按官方 DEFAULT_OUTPUT_BYTES_CAP 截断");
    expect(result).toContain("事实源：app-server 原始 item");
    expect(result.length).toBeLessThan(input.length);
  });
});
