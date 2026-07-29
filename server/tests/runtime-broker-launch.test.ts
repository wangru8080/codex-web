import { describe, expect, it } from "vitest";

import { parseRuntimeBrokerConfig } from "../runtime-broker-config";
import {
  buildBrokerRuntimeProcessOptions,
  resolveBrokerRuntimeUsers,
} from "../runtime-broker-launch";

const HASH = "scrypt$v1$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

describe("runtime broker 用户启动", () => {
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

    const options = buildBrokerRuntimeProcessOptions(config, users.get("codex")!);
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

    expect(buildBrokerRuntimeProcessOptions(config, users.get("root")!)).toMatchObject({
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
});
