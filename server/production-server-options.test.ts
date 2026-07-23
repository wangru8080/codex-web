import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { readProductionPort, resolveProductionServerPaths } from "./production-server-options";

describe("resolveProductionServerPaths", () => {
  it("从入口模块位置解析应用根目录，并保留启动工作目录", () => {
    const paths = resolveProductionServerPaths(
      new URL("../scripts/start-next-with-bridge.ts", import.meta.url).toString(),
      "/tmp/codex-user-project",
    );

    const expectedRoot = resolve(fileURLToPath(new URL("../", import.meta.url)));
    expect(paths.applicationRoot).toBe(expectedRoot);
    expect(paths.workingDirectory).toBe("/tmp/codex-user-project");
    expect(paths.buildIdPath).toBe(resolve(expectedRoot, ".next", "BUILD_ID"));
  });

  it("CLI 可以显式指定安装包应用根目录", () => {
    const paths = resolveProductionServerPaths(
      new URL("../dist/cli/codex-web.mjs", import.meta.url).toString(),
      "/tmp/codex-user-project",
      "/opt/codex-web",
    );

    expect(paths.applicationRoot).toBe("/opt/codex-web");
    expect(paths.workingDirectory).toBe("/tmp/codex-user-project");
    expect(paths.buildIdPath).toBe(resolve("/opt/codex-web", ".next", "BUILD_ID"));
  });
});

describe("readProductionPort", () => {
  it("未设置 PORT 时交给系统随机选择端口", () => {
    expect(readProductionPort(undefined)).toBe(0);
    expect(readProductionPort("")).toBe(0);
  });

  it("保留显式合法端口", () => {
    expect(readProductionPort("4123")).toBe(4123);
    expect(readProductionPort("0")).toBe(0);
    expect(readProductionPort("65535")).toBe(65535);
  });

  it("拒绝非法端口", () => {
    for (const value of ["abc", "12.5", "-1", "65536", " 3000 "]) {
      expect(() => readProductionPort(value)).toThrow("PORT 必须是 0 到 65535 的整数");
    }
  });
});
