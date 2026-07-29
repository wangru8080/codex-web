import { describe, expect, it } from "vitest";

import { parseRuntimeBrokerConfig } from "../runtime-broker-config";
import {
  createBrokerSession,
  verifyBrokerSession,
} from "../runtime-broker-session";

const HASH = "scrypt$v1$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

function config(passwordHash = HASH) {
  return parseRuntimeBrokerConfig({
    version: 1,
    sessionSecret: "0123456789abcdef0123456789abcdef",
    sessionMaxAgeSeconds: 60,
    codexCommand: "/usr/local/bin/codex",
    users: [{
      id: "codex",
      email: "codex@example.com",
      passwordHash,
      osUser: "codex",
      home: "/home/codex",
      codexHome: "/home/codex/CodexApp",
      cwd: "/home/codex/workspace",
    }],
  });
}

describe("runtime broker Session", () => {
  it("签发并验证包含用户身份的 Session", () => {
    const brokerConfig = config();
    const token = createBrokerSession(brokerConfig.users[0]!, brokerConfig, 1_000);

    expect(verifyBrokerSession(token, brokerConfig, 30_000)).toMatchObject({
      id: "codex",
      email: "codex@example.com",
      osUser: "codex",
      role: "user",
    });
  });

  it("拒绝篡改、过期和凭据变化后的 Session", () => {
    const brokerConfig = config();
    const token = createBrokerSession(brokerConfig.users[0]!, brokerConfig, 1_000);

    expect(verifyBrokerSession(`${token}x`, brokerConfig, 2_000)).toBeNull();
    expect(verifyBrokerSession(token, brokerConfig, 62_000)).toBeNull();
    expect(verifyBrokerSession(token, config(`${HASH.slice(0, -1)}B`), 2_000)).toBeNull();
  });
});
