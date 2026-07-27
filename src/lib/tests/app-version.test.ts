import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import packageMetadata from "../../../package.json";
import { APP_VERSION } from "../app-version";

const consumers = [
  "src/components/settings/AboutSection.tsx",
  "src/components/layout/SentryInit.tsx",
  "src/codex-web/AppServerProvider.tsx",
  "server/app-server-session.ts",
  "scripts/codex-web-cli.ts",
];

describe("应用版本单一来源", () => {
  it("从 package.json 导出应用版本", () => {
    expect(APP_VERSION).toBe(packageMetadata.version);
  });

  it("所有运行时消费者使用共享版本", () => {
    for (const path of consumers) {
      const source = readFileSync(resolve(process.cwd(), path), "utf8");
      expect(source, path).toContain("APP_VERSION");
      expect(source, path).not.toContain("NEXT_PUBLIC_APP_VERSION");
      expect(source, path).not.toMatch(/["']\d+\.\d+\.\d+["']/);
    }
  });
});
