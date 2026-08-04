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
      dependencies: Record<string, string>;
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
    expect(packageJson.dependencies.next).toBe("16.2.10");
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

  it("只发布 codex-web CLI，并由 runtime 子命令启动多用户服务", () => {
    const packageJson = JSON.parse(
      readFileSync(resolve(repositoryRoot, "package.json"), "utf8"),
    ) as {
      bin: Record<string, string>;
      files: string[];
    };
    const cliBuilder = readFileSync(resolve(repositoryRoot, "scripts/build-cli.ts"), "utf8");
    const runtimeCli = readFileSync(resolve(repositoryRoot, "scripts/codex-web-broker-cli.ts"), "utf8");
    const webService = readFileSync(resolve(repositoryRoot, "deploy/systemd/codex-web.service"), "utf8");
    const runtimeService = readFileSync(
      resolve(repositoryRoot, "deploy/systemd/codex-web-runtime.service"),
      "utf8",
    );
    const runtimeLaunchDaemon = readFileSync(
      resolve(repositoryRoot, "deploy/launchd/com.codex-web.runtime.plist"),
      "utf8",
    );
    const webLaunchDaemon = readFileSync(
      resolve(repositoryRoot, "deploy/launchd/com.codex-web.web.plist"),
      "utf8",
    );
    const macUsers = JSON.parse(readFileSync(
      resolve(repositoryRoot, "deploy/launchd/users.example.json"),
      "utf8",
    )) as { setprivCommand?: string; users: Array<{ osUser: string; home: string }> };

    expect(packageJson.bin).toEqual({ "codex-web": "dist/cli/codex-web.mjs" });
    expect(packageJson.files).toContain("dist/cli/codex-web.mjs");
    expect(packageJson.files).not.toContain("dist/cli/");
    expect(cliBuilder).not.toContain('"codex-web-broker"');
    expect(runtimeCli).toContain("watchRuntimeBrokerConfig");
    expect(runtimeCli).toContain("broker.reload(");
    expect(runtimeCli).toContain("继续使用当前配置");
    expect(webService).toContain("Requires=codex-web-runtime.service");
    expect(runtimeService).toContain("/usr/local/bin/codex-web runtime serve");
    expect(runtimeLaunchDaemon).toContain("<string>/usr/local/bin/codex-web</string>");
    expect(runtimeLaunchDaemon).toContain("<string>runtime</string>");
    expect(runtimeLaunchDaemon).toContain("<string>serve</string>");
    expect(runtimeLaunchDaemon).not.toContain("<key>UserName</key>");
    expect(webLaunchDaemon).toContain("<string>/usr/local/bin/codex-web</string>");
    expect(webLaunchDaemon).toContain("<string>serve</string>");
    expect(webLaunchDaemon).toContain("<key>UserName</key>");
    expect(runtimeLaunchDaemon).toContain("/Library/Application Support/CodexWeb/run/runtime-broker.sock");
    expect(webLaunchDaemon).toContain("/Library/Application Support/CodexWeb/run/runtime-broker.sock");
    expect(macUsers.setprivCommand).toBeUndefined();
    expect(macUsers.users).toEqual(expect.arrayContaining([
      expect.objectContaining({ osUser: "exampleuser", home: "/Users/exampleuser" }),
    ]));
    expect(JSON.stringify(macUsers)).not.toContain("rrssnas");
    expect(JSON.stringify(macUsers)).not.toContain('"wr"');
  });
});
