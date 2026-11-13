import fs from "node:fs";
import path from "node:path";
import type { ScreenShareCapability, ScreenShareConfig } from "./types";

export type ProbeDependencies = {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  fileExistsAndExecutable?: (filePath: string) => boolean;
};

export function isExecutable(filePath: string): boolean {
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function findExecutableOnPath(
  binaryName: string,
  pathEnv: string | undefined,
  checkExecutable: (filePath: string) => boolean = isExecutable,
): string | null {
  if (!pathEnv) return null;
  const dirs = pathEnv.split(path.delimiter);
  for (const dir of dirs) {
    if (!dir) continue;
    const fullPath = path.join(dir, binaryName);
    if (checkExecutable(fullPath)) {
      return fullPath;
    }
  }
  return null;
}

export function probeScreenShareCapability(
  config: ScreenShareConfig,
  deps: ProbeDependencies = {},
): ScreenShareCapability {
  if (!config.enabled) {
    return { status: "disabled" };
  }

  const platform = deps.platform ?? process.platform;
  if (platform !== "linux") {
    return {
      status: "unsupported",
      reason: `Platform "${platform}" is not supported (Linux X11 only)`,
    };
  }

  const env = deps.env ?? process.env;
  const display = config.display || env.DISPLAY?.trim();
  if (!display) {
    if (env.XDG_SESSION_TYPE?.trim() === "wayland") {
      return {
        status: "unsupported",
        reason: "Wayland session detected without X11 DISPLAY",
      };
    }
    return {
      status: "unsupported",
      reason: "No X11 DISPLAY found in environment",
    };
  }

  const checkExecutable = deps.fileExistsAndExecutable ?? isExecutable;
  let resolvedVncPath: string | null = null;
  if (config.x11vncPath) {
    if (checkExecutable(config.x11vncPath)) {
      resolvedVncPath = config.x11vncPath;
    } else {
      return {
        status: "unsupported",
        reason: `Configured x11vnc binary "${config.x11vncPath}" is not executable or not found`,
      };
    }
  } else {
    resolvedVncPath = findExecutableOnPath("x11vnc", env.PATH, checkExecutable);
    if (!resolvedVncPath) {
      return {
        status: "unsupported",
        reason: "x11vnc binary not found on PATH",
      };
    }
  }

  return {
    status: "available",
    display,
    wsPath: config.wsPath,
  };
}
