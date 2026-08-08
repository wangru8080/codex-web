import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  mergeTurnstileConfig,
  publicTurnstileConfig,
  readTurnstileConfig,
  turnstileConfigPath,
  turnstileStateDirectory,
  writeTurnstileConfig,
  type TurnstileConfig,
} from "../turnstile-config";

const configured: TurnstileConfig = {
  enabled: true,
  siteKey: "site-key",
  secretKey: "secret-key",
};

describe("Turnstile 配置", () => {
  it("优先使用独立的 Web 状态目录", () => {
    expect(turnstileConfigPath({
      NODE_ENV: "test",
      CODEX_WEB_STATE: "/srv/codex-web-state",
      CODEX_HOME: "/home/user/.codex",
    })).toBe("/srv/codex-web-state/turnstile.json");
  });

  it("未设置 Web 状态目录时统一使用启动用户 home 下的 .codex-web", () => {
    expect(turnstileStateDirectory({ CODEX_HOME: "/ignored/.codex" }, "/home/user"))
      .toBe("/home/user/.codex-web");
    expect(turnstileConfigPath({}, "/root")).toBe("/root/.codex-web/turnstile.json");
  });

  it("未设置 Web 状态目录时不读取 CODEX_HOME 下的旧路径", async () => {
    const directory = await mkdtemp(join(tmpdir(), "codex-web-turnstile-codex-home-"));
    const legacyDirectory = join(directory, "codex-web");
    await mkdir(legacyDirectory);
    await writeFile(join(legacyDirectory, "turnstile.json"), JSON.stringify({
      enabled: true, siteKey: "codex-home-site", secretKey: "codex-home-secret",
    }));

    await expect(readTurnstileConfig({ CODEX_HOME: directory }, "/home/user"))
      .resolves.toEqual({ enabled: false, siteKey: "", secretKey: "" });
  });

  it("只读取新路径，不读取旧子目录", async () => {
    const directory = await mkdtemp(join(tmpdir(), "codex-web-turnstile-path-"));
    const legacyDirectory = join(directory, "codex-web");
    await mkdir(legacyDirectory);
    await writeFile(join(legacyDirectory, "turnstile.json"), JSON.stringify({
      enabled: true, siteKey: "legacy-site", secretKey: "legacy-secret",
    }));
    await expect(readTurnstileConfig({ CODEX_WEB_STATE: directory }, "/ignored"))
      .resolves.toEqual({ enabled: false, siteKey: "", secretKey: "" });

    await writeFile(join(directory, "turnstile.json"), JSON.stringify({
      enabled: false, siteKey: "new-site", secretKey: "new-secret",
    }));
    await expect(readTurnstileConfig({ CODEX_WEB_STATE: directory }, "/ignored"))
      .resolves.toMatchObject({ siteKey: "new-site" });
  });

  it("保存统一写入新路径并设置目录 0700、文件 0600", async () => {
    const parent = await mkdtemp(join(tmpdir(), "codex-web-turnstile-write-"));
    const state = join(parent, "state");
    await writeTurnstileConfig(
      { enabled: false, siteKey: "site", secretKey: "secret" },
      { CODEX_WEB_STATE: state },
      "/ignored",
    );
    expect(JSON.parse(await readFile(join(state, "turnstile.json"), "utf8"))).toEqual({
      enabled: false, siteKey: "site", secretKey: "secret",
    });
    expect((await stat(state)).mode & 0o777).toBe(0o700);
    expect((await stat(join(state, "turnstile.json"))).mode & 0o777).toBe(0o600);
  });

  it("公开配置永不包含私密密钥", () => {
    expect(publicTurnstileConfig(configured)).toEqual({
      enabled: true,
      siteKey: "site-key",
      secretKeyConfigured: true,
    });
  });

  it("空私密密钥保留当前值", () => {
    expect(
      mergeTurnstileConfig(configured, { enabled: false, siteKey: "new-site", secretKey: "" }),
    ).toEqual({ enabled: false, siteKey: "new-site", secretKey: "secret-key" });
  });

  it("启用时要求站点密钥和私密密钥", () => {
    expect(() =>
      mergeTurnstileConfig(
        { enabled: false, siteKey: "", secretKey: "" },
        { enabled: true, siteKey: "site", secretKey: "" },
      ),
    ).toThrow("私密密钥");
  });
});
