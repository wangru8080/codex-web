import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";
import { homedir } from "node:os";

export type TurnstileConfig = {
  enabled: boolean;
  siteKey: string;
  secretKey: string;
};

export type TurnstileConfigUpdate = {
  enabled: boolean;
  siteKey: string;
  secretKey?: string;
};

type TurnstileEnvironment = Readonly<Record<string, string | undefined>>;

export const EMPTY_TURNSTILE_CONFIG: TurnstileConfig = {
  enabled: false,
  siteKey: "",
  secretKey: "",
};

export function turnstileStateDirectory(env: TurnstileEnvironment = process.env, home = homedir()): string {
  return env.CODEX_WEB_STATE?.trim() || join(home, ".codex-web");
}

export function turnstileConfigPath(env: TurnstileEnvironment = process.env, home = homedir()): string {
  return join(turnstileStateDirectory(env, home), "turnstile.json");
}

export async function readTurnstileConfig(env: TurnstileEnvironment = process.env, home = homedir()): Promise<TurnstileConfig> {
  return readTurnstileConfigAt(turnstileConfigPath(env, home));
}

export async function readTurnstileConfigAt(path: string): Promise<TurnstileConfig> {
  try {
    return parseTurnstileConfig(await readFile(path, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return { ...EMPTY_TURNSTILE_CONFIG };
}

function parseTurnstileConfig(contents: string): TurnstileConfig {
  const value = JSON.parse(contents) as Partial<TurnstileConfig>;
  return {
    enabled: value.enabled === true,
    siteKey: typeof value.siteKey === "string" ? value.siteKey.trim() : "",
    secretKey: typeof value.secretKey === "string" ? value.secretKey.trim() : "",
  };
}

export function mergeTurnstileConfig(
  current: TurnstileConfig,
  update: TurnstileConfigUpdate,
): TurnstileConfig {
  const next = {
    enabled: update.enabled,
    siteKey: update.siteKey.trim(),
    secretKey: update.secretKey?.trim() || current.secretKey,
  };
  if (next.enabled && !next.siteKey) throw new Error("启用 Turnstile 前必须填写站点密钥");
  if (next.enabled && !next.secretKey) throw new Error("启用 Turnstile 前必须填写私密密钥");
  return next;
}

export async function writeTurnstileConfig(
  update: TurnstileConfigUpdate,
  env: TurnstileEnvironment = process.env,
  home = homedir(),
): Promise<TurnstileConfig> {
  return writeTurnstileConfigAt(
    update,
    turnstileConfigPath(env, home),
  );
}

export async function writeTurnstileConfigAt(
  update: TurnstileConfigUpdate,
  path: string,
): Promise<TurnstileConfig> {
  const current = await readTurnstileConfigAt(path);
  const next = mergeTurnstileConfig(current, update);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await chmod(dirname(path), 0o700);
  const temporaryPath = `${path}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(next, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  await rename(temporaryPath, path);
  await chmod(path, 0o600);
  return next;
}

export function publicTurnstileConfig(config: TurnstileConfig) {
  return {
    enabled: config.enabled,
    siteKey: config.siteKey,
    secretKeyConfigured: config.secretKey.length > 0,
  };
}
