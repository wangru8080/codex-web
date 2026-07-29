import { describe, expect, it } from "vitest";

import {
  hashBrokerPassword,
  verifyBrokerPassword,
} from "../runtime-broker-password";

describe("runtime broker 密码", () => {
  it("使用带版本和参数的 scrypt 格式验证密码", async () => {
    const encoded = await hashBrokerPassword("correct horse battery staple");

    expect(encoded).toMatch(/^scrypt\$v1\$16384\$8\$1\$/);
    await expect(verifyBrokerPassword("correct horse battery staple", encoded)).resolves.toBe(true);
    await expect(verifyBrokerPassword("wrong", encoded)).resolves.toBe(false);
  });

  it("损坏或未知版本的哈希直接拒绝", async () => {
    await expect(verifyBrokerPassword("password", "broken")).resolves.toBe(false);
    await expect(
      verifyBrokerPassword("password", "scrypt$v2$16384$8$1$c2FsdA$aGFzaA"),
    ).resolves.toBe(false);
  });
});
