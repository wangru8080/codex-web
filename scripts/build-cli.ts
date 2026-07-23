import { chmod } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const outputFile = resolve(repositoryRoot, "dist/cli/codex-web.mjs");

await build({
  entryPoints: [resolve(repositoryRoot, "scripts/codex-web-cli.ts")],
  outfile: outputFile,
  bundle: true,
  packages: "external",
  platform: "node",
  format: "esm",
  target: "node20.9",
  banner: { js: "#!/usr/bin/env node" },
  legalComments: "none",
  logLevel: "info",
});

await chmod(outputFile, 0o755);
