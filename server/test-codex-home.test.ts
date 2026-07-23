import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { defaultTestCodexHome, resolveTestCodexHome } from "./test-codex-home";

describe("resolveTestCodexHome", () => {
  it("未设置或只设置空白值时使用默认测试隔离目录", () => {
    expect(resolveTestCodexHome({})).toBe(defaultTestCodexHome);
    expect(resolveTestCodexHome({ CODEX_HOME: "   " })).toBe(defaultTestCodexHome);
  });

  it("保留用户显式设置的自定义或真实 CODEX_HOME", () => {
    expect(resolveTestCodexHome({ CODEX_HOME: "/tmp/codex-smoke-a" })).toBe("/tmp/codex-smoke-a");
    expect(resolveTestCodexHome({ CODEX_HOME: "/home/tester/.codex" })).toBe("/home/tester/.codex");
  });
});

describe("smoke CODEX_HOME 接线", () => {
  it("TypeScript smoke 使用共享解析器且不再精确拒绝默认路径之外的值", () => {
    const files = [
      "scripts/smoke.ts",
      "scripts/interrupt-smoke.ts",
      "scripts/reconnect-smoke.ts",
      "scripts/permission-policy-smoke.ts",
      "scripts/permission-policy-tool-e2e.ts",
      "scripts/goal-plan-plus-smoke.ts",
      "scripts/app-server-recovery-smoke.ts",
      "scripts/user-input-server-request-smoke.ts",
    ];

    for (const file of files) {
      const source = readFileSync(resolve(process.cwd(), file), "utf8");
      expect(source, file).toContain("resolveTestCodexHome");
      expect(source, file).not.toContain("requiredCodexHome");
      expect(source, file).not.toContain("process.env.CODEX_HOME !==");
    }
  });

  it("旧版 MJS smoke 也允许环境变量覆盖默认值", () => {
    const source = readFileSync(resolve(process.cwd(), "scripts/smoke.mjs"), "utf8");

    expect(source).toContain("process.env.CODEX_HOME?.trim() || defaultTestCodexHome");
    expect(source).not.toContain("process.env.CODEX_HOME !==");
  });
});
