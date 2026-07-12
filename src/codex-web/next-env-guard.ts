import { readFileSync, writeFileSync } from "node:fs";

export const CANONICAL_NEXT_ENV_CONTENT = [
  "/// <reference types=\"next\" />",
  "/// <reference types=\"next/image-types/global\" />",
  'import "./.next/dev/types/routes.d.ts";',
  "",
  "// NOTE: This file should not be edited",
  "// see https://nextjs.org/docs/app/api-reference/config/typescript for more information.",
  "",
].join("\n");

export function isCanonicalNextEnv(contents: string): boolean {
  return contents === CANONICAL_NEXT_ENV_CONTENT;
}

export function restoreNextEnvFile(filePath: string): boolean {
  const current = readFileSync(filePath, "utf8");
  if (isCanonicalNextEnv(current)) {
    return false;
  }
  writeFileSync(filePath, CANONICAL_NEXT_ENV_CONTENT, "utf8");
  return true;
}
