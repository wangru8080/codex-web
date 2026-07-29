import { chmod } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const outputFiles = [
  resolve(repositoryRoot, "dist/cli/codex-web.mjs"),
  resolve(repositoryRoot, "dist/cli/codex-web-broker.mjs"),
];

await build({
  entryPoints: {
    "codex-web": resolve(repositoryRoot, "scripts/codex-web-cli.ts"),
    "codex-web-broker": resolve(repositoryRoot, "scripts/codex-web-broker-cli.ts"),
  },
  outdir: resolve(repositoryRoot, "dist/cli"),
  outExtension: { ".js": ".mjs" },
  bundle: true,
  packages: "external",
  platform: "node",
  format: "esm",
  target: "node20.9",
  banner: { js: "#!/usr/bin/env node" },
  legalComments: "none",
  logLevel: "info",
});

await Promise.all(outputFiles.map((outputFile) => chmod(outputFile, 0o755)));
