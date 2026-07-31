import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve(process.cwd(), "src/codex-web/DiagnosticsBridgePanel.tsx"), "utf8");

describe("运行时诊断 breadcrumb 接线", () => {
  it("读取认证用户并保留 app-server initialize 来源", () => {
    expect(source).toContain('fetch("/api/auth/me", { cache: "no-store" })');
    expect(source).toContain("initialize?.data.codexHome");
    expect(source).toContain("authUser?.user?.email");
    expect(source).toContain("authUser?.user?.osUser");
    expect(source).toContain("authUser?.user?.codexHome");
    expect(source).toContain('"unsupported"');
  });
});
