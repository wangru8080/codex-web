import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

const configUrl = pathToFileURL(resolve(process.cwd(), "next.config.mjs")).href;

function readProductionBrowserSourceMaps(value?: string): boolean {
  const env = { ...process.env };
  if (value === undefined) delete env.CODEX_WEB_PROFILE_SOURCE_MAPS;
  else env.CODEX_WEB_PROFILE_SOURCE_MAPS = value;
  const result = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `import config from ${JSON.stringify(configUrl)}; process.stdout.write(JSON.stringify(Boolean(config.productionBrowserSourceMaps)));`,
    ],
    { encoding: "utf8", env },
  );
  if (result.status !== 0) throw new Error(result.stderr);
  return JSON.parse(result.stdout) as boolean;
}

describe("生产浏览器 Source Map 配置", () => {
  it("默认关闭，只接受显式诊断开关", () => {
    expect(readProductionBrowserSourceMaps()).toBe(false);
    expect(readProductionBrowserSourceMaps("")).toBe(false);
    expect(readProductionBrowserSourceMaps("true")).toBe(false);
    expect(readProductionBrowserSourceMaps("1")).toBe(true);
  });
});
