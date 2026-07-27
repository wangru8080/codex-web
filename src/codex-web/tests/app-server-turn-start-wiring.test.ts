import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const provider = readFileSync(new URL("../AppServerProvider.tsx", import.meta.url), "utf8");

describe("app-server Turn 开始时间接线", () => {
  it("turn/start 响应把真实开始时间写入 accepted Turn", () => {
    expect(provider).toContain("turnStartedAtMs(turnResponse.turn.startedAt)");
  });
});
