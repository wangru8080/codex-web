import { describe, expect, it } from "vitest";

import { parseRuntimeBrokerConfig } from "../runtime-broker-config";
import {
  buildBrokerRuntimeProcessOptions,
  parseLoginEnvironmentOutput,
  parseDarwinUserRecord,
  resolveBrokerRuntimeUsers,
  resolveRuntimeBrokerPlatform,
} from "../runtime-broker-launch";

const HASH = "scrypt$v1$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

describe("runtime broker 用户启动", () => {
  it("按用户加载登录环境，并由显式 env 覆盖同名变量", async () => {
    const config = parseRuntimeBrokerConfig({
      version: 1,
      sessionSecret: "0123456789abcdef0123456789abcdef",
      codexCommand: "/opt/node/bin/codex",
      users: [
        {
          id: "alice",
          email: "alice@example.com",
          passwordHash: HASH,
          osUser: "alice",
          home: "/home/alice",
          codexHome: "/home/alice/CodexApp",
          cwd: "/home/alice/workspace",
          inheritLoginEnvironment: true,
          env: { TOKEN: "alice-explicit" },
        },
        {
          id: "bob",
          email: "bob@example.com",
          passwordHash: HASH,
          osUser: "bob",
          home: "/home/bob",
          codexHome: "/home/bob/CodexApp",
          cwd: "/home/bob/workspace",
          inheritLoginEnvironment: true,
        },
      ],
    });
    const users = await resolveBrokerRuntimeUsers(
      config,
      async (osUser) => ({
        uid: osUser === "alice" ? 1001 : 1002,
        gid: 100,
        home: `/home/${osUser}`,
        shell: "/bin/bash",
      }),
      async (_config, user) => ({ TOKEN: `${user.id}-profile`, [`${user.id.toUpperCase()}_ONLY`]: "1" }),
    );

    expect(users.get("alice")?.env).toEqual({
      TOKEN: "alice-explicit",
      ALICE_ONLY: "1",
    });
    expect(users.get("bob")?.env).toEqual({
      TOKEN: "bob-profile",
      BOB_ONLY: "1",
    });
  });

  it("只解析登录 shell 环境标记后的变量并过滤身份变量", () => {
    const output = Buffer.from(
      "profile banner\n\0CODEX_WEB_LOGIN_ENV_V1\0TOKEN=value\0HOME=/wrong\0PATH=/custom/bin\0",
    );
    expect(parseLoginEnvironmentOutput(output, "alice")).toEqual({
      TOKEN: "value",
      PATH: "/custom/bin",
    });
    expect(() => parseLoginEnvironmentOutput("no marker", "alice"))
      .toThrow("未返回环境标记");
  });

  it("普通用户通过 setpriv 初始化身份并清除 capability", async () => {
    const config = parseRuntimeBrokerConfig({
      version: 1,
      sessionSecret: "0123456789abcdef0123456789abcdef",
      codexCommand: "/opt/node/bin/codex",
      users: [{
        id: "codex",
        email: "codex@example.com",
        passwordHash: HASH,
        osUser: "codex",
        home: "/home/codex",
        codexHome: "/home/codex/CodexApp",
        cwd: "/home/codex/workspace",
        env: { CARGO_HOME: "/home/codex/.cargo" },
      }],
    });
    const users = await resolveBrokerRuntimeUsers(config, async () => ({
      uid: 1004,
      gid: 100,
      home: "/home/codex",
      shell: "/bin/bash",
    }));

    const options = buildBrokerRuntimeProcessOptions(config, users.get("codex")!, "linux");
    expect(options).toMatchObject({
      command: "/usr/bin/setpriv",
      cwd: "/home/codex/workspace",
      codexHome: "/home/codex/CodexApp",
      inheritEnv: false,
      env: {
        HOME: "/home/codex",
        USER: "codex",
        LOGNAME: "codex",
        SHELL: "/bin/bash",
        CARGO_HOME: "/home/codex/.cargo",
      },
    });
    expect(options.args).toEqual([
      "--reuid=1004",
      "--regid=100",
      "--init-groups",
      "--inh-caps=-all",
      "--ambient-caps=-all",
      "--bounding-set=-all",
      "--pdeathsig=SIGTERM",
      "--",
      "/opt/node/bin/codex",
      "app-server",
      "--stdio",
    ]);
  });

  it("root 双重授权后直接启动固定 codex command", async () => {
    const config = parseRuntimeBrokerConfig({
      version: 1,
      sessionSecret: "0123456789abcdef0123456789abcdef",
      allowRootRuntime: true,
      codexCommand: "/opt/node/bin/codex",
      users: [{
        id: "root",
        email: "root@example.com",
        passwordHash: HASH,
        osUser: "root",
        home: "/root",
        codexHome: "/root/CodexApp",
        cwd: "/root",
        allowRoot: true,
      }],
    });
    const users = await resolveBrokerRuntimeUsers(config, async () => ({
      uid: 0,
      gid: 0,
      home: "/root",
      shell: "/bin/bash",
    }));

    expect(buildBrokerRuntimeProcessOptions(config, users.get("root")!, "linux")).toMatchObject({
      command: "/opt/node/bin/codex",
      args: ["app-server", "--stdio"],
      inheritEnv: false,
    });
  });

  it("拒绝配置用户名与系统 home 不一致以及 UID 0 别名", async () => {
    const base = parseRuntimeBrokerConfig({
      version: 1,
      sessionSecret: "0123456789abcdef0123456789abcdef",
      codexCommand: "/opt/node/bin/codex",
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
    await expect(resolveBrokerRuntimeUsers(base, async () => ({
      uid: 1004,
      gid: 100,
      home: "/different",
      shell: "/bin/bash",
    }))).rejects.toThrow("home");
    await expect(resolveBrokerRuntimeUsers(base, async () => ({
      uid: 0,
      gid: 0,
      home: "/home/codex",
      shell: "/bin/bash",
    }))).rejects.toThrow("UID 0");
  });

  it("只允许 Linux 与 macOS 启动多用户 runtime", () => {
    expect(resolveRuntimeBrokerPlatform("linux")).toBe("linux");
    expect(resolveRuntimeBrokerPlatform("darwin")).toBe("darwin");
    expect(() => resolveRuntimeBrokerPlatform("win32")).toThrow("仅支持 Linux 和 macOS");
    expect(() => resolveRuntimeBrokerPlatform("freebsd")).toThrow("仅支持 Linux 和 macOS");
  });

  it("解析 macOS dscacheutil 用户记录并拒绝缺失或非法字段", () => {
    expect(parseDarwinUserRecord("alice", [
      "name: alice",
      "uid: 502",
      "gid: 20",
      "dir: /Users/alice",
      "shell: /bin/zsh",
    ].join("\n"))).toEqual({
      uid: 502,
      gid: 20,
      home: "/Users/alice",
      shell: "/bin/zsh",
    });
    expect(parseDarwinUserRecord("root", [
      "name: root",
      "uid: 0",
      "gid: 0",
      "dir: /var/root",
      "shell: /bin/sh",
    ].join("\n"))).toEqual({
      uid: 0,
      gid: 0,
      home: "/var/root",
      shell: "/bin/sh",
    });

    expect(() => parseDarwinUserRecord("alice", [
      "uid: 502",
      "gid: staff",
      "dir: /Users/alice",
      "shell: /bin/zsh",
    ].join("\n"))).toThrow("alice");
    expect(() => parseDarwinUserRecord("alice", [
      "uid: 502",
      "gid: 20",
      "dir: /Users/alice",
    ].join("\n"))).toThrow("alice");
  });

  it("macOS 普通用户通过固定 sudo 和 env -i 初始化身份与干净环境", async () => {
    const config = parseRuntimeBrokerConfig({
      version: 1,
      sessionSecret: "0123456789abcdef0123456789abcdef",
      codexCommand: "/usr/local/bin/codex",
      users: [{
        id: "alice",
        email: "alice@example.com",
        passwordHash: HASH,
        osUser: "alice",
        home: "/Users/alice",
        codexHome: "/private/tmp/codex-home-alice",
        cwd: "/private/tmp/workspace-alice",
        env: { CARGO_HOME: "/Users/alice/.cargo" },
      }],
    });
    const users = await resolveBrokerRuntimeUsers(config, async () => ({
      uid: 502,
      gid: 20,
      home: "/Users/alice",
      shell: "/bin/zsh",
    }));

    const options = buildBrokerRuntimeProcessOptions(config, users.get("alice")!, "darwin");
    expect(options).toMatchObject({
      command: "/usr/bin/sudo",
      cwd: "/private/tmp/workspace-alice",
      codexHome: "/private/tmp/codex-home-alice",
      inheritEnv: false,
    });
    expect(options.args).toEqual([
      "-n",
      "-H",
      "-u",
      "alice",
      "--",
      "/usr/bin/env",
      "-i",
      "CARGO_HOME=/Users/alice/.cargo",
      "CODEX_HOME=/private/tmp/codex-home-alice",
      "HOME=/Users/alice",
      "LOGNAME=alice",
      "NODE_ENV=production",
      "PATH=/usr/local/bin:/usr/local/bin:/usr/bin:/bin",
      "RUST_LOG=warn",
      "SHELL=/bin/zsh",
      "USER=alice",
      "/usr/local/bin/codex",
      "app-server",
      "--stdio",
    ]);
    expect(options.args).not.toContain("-c");
  });
});
