import { resolve } from "node:path";

import { restoreNextEnvFile } from "../src/codex-web/next-env-guard";

const nextEnvPath = resolve(process.cwd(), "next-env.d.ts");

if (restoreNextEnvFile(nextEnvPath)) {
  console.log(`[next-env-guard] restored ${nextEnvPath} to ./.next/dev/types/routes.d.ts`);
}
