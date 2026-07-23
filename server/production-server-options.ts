import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

export type ProductionServerPaths = {
  applicationRoot: string;
  workingDirectory: string;
  buildIdPath: string;
};

export function resolveProductionServerPaths(
  entryModuleUrl: string,
  workingDirectory = process.cwd(),
): ProductionServerPaths {
  const applicationRoot = resolve(fileURLToPath(new URL("../", entryModuleUrl)));
  return {
    applicationRoot,
    workingDirectory,
    buildIdPath: resolve(applicationRoot, ".next", "BUILD_ID"),
  };
}

export function readProductionPort(value: string | undefined): number {
  if (value === undefined || value === "") return 0;
  if (!/^\d+$/.test(value)) throw invalidPortError();
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 0 || port > 65535) throw invalidPortError();
  return port;
}

function invalidPortError(): Error {
  return new Error("PORT 必须是 0 到 65535 的整数");
}
