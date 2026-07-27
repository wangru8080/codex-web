import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  CANONICAL_NEXT_ENV_CONTENT,
  isCanonicalNextEnv,
  restoreNextEnvFile,
} from "../next-env-guard";

describe("next-env guard", () => {
  it("pins next-env.d.ts to the dev routes path", () => {
    expect(isCanonicalNextEnv(CANONICAL_NEXT_ENV_CONTENT)).toBe(true);
    expect(CANONICAL_NEXT_ENV_CONTENT).toContain('./.next/dev/types/routes.d.ts');
    expect(CANONICAL_NEXT_ENV_CONTENT).not.toContain('./.next/types/routes.d.ts');
  });

  it("restores a rewritten next-env file back to the canonical dev path", () => {
    const dir = mkdtempSync(join(tmpdir(), "codex-next-env-"));
    const filePath = join(dir, "next-env.d.ts");
    writeFileSync(
      filePath,
      CANONICAL_NEXT_ENV_CONTENT.replace('./.next/dev/types/routes.d.ts', './.next/types/routes.d.ts'),
      "utf8",
    );

    expect(restoreNextEnvFile(filePath)).toBe(true);
    expect(readFileSync(filePath, "utf8")).toBe(CANONICAL_NEXT_ENV_CONTENT);
    expect(restoreNextEnvFile(filePath)).toBe(false);
  });
});
