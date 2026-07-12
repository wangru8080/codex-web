import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const generatedParamFiles = [
  "../codex/protocol/generated/v2/ThreadStartParams.ts",
  "../codex/protocol/generated/v2/TurnStartParams.ts",
];

describe("app-server request override guardrail", () => {
  it("generated start params 仍未暴露 collaborationMode 时保留 Web 兼容类型", () => {
    for (const file of generatedParamFiles) {
      const source = readFileSync(new URL(file, import.meta.url), "utf8");
      expect(source, `${file} 已包含 collaborationMode，请删除 app-server-request-overrides.ts`).not.toContain(
        "collaborationMode",
      );
    }
  });
});
