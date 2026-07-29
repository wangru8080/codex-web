import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  parseRuntimeBrokerConfig,
  readRuntimeBrokerConfig,
} from "../runtime-broker-config";

const HASH = "scrypt$v1$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

describe("runtime broker 配置", () => {
  it("规范化有效的普通用户配置", () => {
    const config = parseRuntimeBrokerConfig({
      version: 1,
      sessionSecret: "0123456789abcdef0123456789abcdef",
      codexCommand: "/usr/local/bin/codex",
      users: [{
        id: "codex",
        email: "codex@example.com",
        passwordHash: HASH,
        osUser: "codex",
        home: "/home/codex",
        codexHome: "/home/codex/CodexApp",
        cwd: "/home/codex/workspace",
      }],
    });

    expect(config).toMatchObject({
      version: 1,
      allowRootRuntime: false,
      sessionMaxAgeSeconds: 259200,
      disconnectGraceMs: 30000,
      setprivCommand: "/usr/bin/setpriv",
      users: [{ id: "codex", role: "user", enabled: true, allowRoot: false }],
    });
  });

  it("拒绝可能影响 root 启动边界的环境变量", () => {
    expect(() => parseRuntimeBrokerConfig({
      version: 1,
      sessionSecret: "0123456789abcdef0123456789abcdef",
      codexCommand: "/usr/local/bin/codex",
      users: [{
        id: "codex",
        email: "codex@example.com",
        passwordHash: HASH,
        osUser: "codex",
        home: "/home/codex",
        codexHome: "/home/codex/CodexApp",
        cwd: "/home/codex/workspace",
        env: { LD_PRELOAD: "/tmp/inject.so" },
      }],
    })).toThrow("禁止设置");
  });

  it("拒绝重复账号、相对路径和未双重授权的 root", () => {
    const base = {
      version: 1,
      sessionSecret: "0123456789abcdef0123456789abcdef",
      codexCommand: "/usr/local/bin/codex",
    };
    const user = {
      id: "codex",
      email: "codex@example.com",
      passwordHash: HASH,
      osUser: "codex",
      home: "/home/codex",
      codexHome: "/home/codex/CodexApp",
      cwd: "/home/codex/workspace",
    };

    expect(() => parseRuntimeBrokerConfig({ ...base, users: [user, user] })).toThrow("重复");
    expect(() => parseRuntimeBrokerConfig({
      ...base,
      users: [{ ...user, cwd: "relative" }],
    })).toThrow("绝对路径");
    expect(() => parseRuntimeBrokerConfig({
      ...base,
      users: [{
        ...user,
        id: "root",
        email: "root@example.com",
        osUser: "root",
        home: "/root",
        codexHome: "/root/CodexApp",
        cwd: "/root",
        allowRoot: true,
      }],
    })).toThrow("allowRootRuntime");
  });

  it("读取时拒绝组或其他用户可读的配置文件", async () => {
    const directory = await mkdtemp(join(tmpdir(), "codex-web-broker-config-"));
    const path = join(directory, "users.json");
    await writeFile(path, JSON.stringify({
      version: 1,
      sessionSecret: "0123456789abcdef0123456789abcdef",
      codexCommand: "/usr/local/bin/codex",
      users: [],
    }));
    await chmod(path, 0o644);

    await expect(readRuntimeBrokerConfig(path, { expectedOwnerUid: process.getuid?.() }))
      .rejects.toThrow("0600");
  });
});
