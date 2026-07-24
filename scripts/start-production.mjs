import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const builderPath = resolve(repositoryRoot, "scripts/build-production-server.mjs");
const bundlePath = resolve(repositoryRoot, "dist/start-next-with-bridge.mjs");

if (existsSync(builderPath)) {
  const result = spawnSync(process.execPath, [builderPath], { stdio: "inherit" });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

if (!existsSync(bundlePath)) {
  throw new Error(`缺少预编译生产入口：${bundlePath}`);
}

await import(pathToFileURL(bundlePath).href);
