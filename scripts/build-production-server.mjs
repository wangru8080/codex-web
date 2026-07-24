import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));

await build({
  entryPoints: [resolve(repositoryRoot, "scripts/start-next-with-bridge.ts")],
  outfile: resolve(repositoryRoot, "dist/start-next-with-bridge.mjs"),
  bundle: true,
  packages: "external",
  platform: "node",
  format: "esm",
  target: "node20.9",
  legalComments: "none",
  logLevel: "info",
});
