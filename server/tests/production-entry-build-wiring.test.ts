import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));

describe("生产服务入口构建接线", () => {
  it("源码启动和发布构建都生成并加载预编译入口", () => {
    const packageJson = JSON.parse(
      readFileSync(resolve(repositoryRoot, "package.json"), "utf8"),
    ) as {
      files: string[];
      scripts: Record<string, string>;
    };
    const builder = readFileSync(
      resolve(repositoryRoot, "scripts/build-production-server.mjs"),
      "utf8",
    );
    const launcher = readFileSync(resolve(repositoryRoot, "scripts/start-production.mjs"), "utf8");

    expect(packageJson.scripts.start).toBe("node scripts/start-production.mjs");
    expect(packageJson.scripts["build:production-server"]).toBe(
      "node scripts/build-production-server.mjs",
    );
    expect(packageJson.scripts["build:cli"]).toContain("npm run build:production-server");
    expect(packageJson.files).toContain("dist/start-next-with-bridge.mjs");
    expect(packageJson.files).toContain("scripts/start-production.mjs");

    expect(builder).toContain('entryPoints: [resolve(repositoryRoot, "scripts/start-next-with-bridge.ts")]');
    expect(builder).toContain('outfile: resolve(repositoryRoot, "dist/start-next-with-bridge.mjs")');
    expect(builder).toContain('packages: "external"');
    expect(builder).toContain('target: "node20.9"');

    expect(launcher).toContain("existsSync(builderPath)");
    expect(launcher).toContain("spawnSync(process.execPath, [builderPath]");
    expect(launcher).toContain("await import(pathToFileURL(bundlePath).href)");
  });
});
