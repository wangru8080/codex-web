import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";

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

export const EMPTY_TURNSTILE_CONFIG: TurnstileConfig = {
  enabled: false,
  siteKey: "",
  secretKey: "",
};

export function turnstileConfigPath(env = process.env): string {
  const codexHome = env.CODEX_HOME?.trim();
  if (!codexHome) throw new Error("CODEX_HOME 未设置，无法读取 Turnstile 配置");
  return join(codexHome, "codex-web", "turnstile.json");
}

export async function readTurnstileConfig(env = process.env): Promise<TurnstileConfig> {
  try {
    const value = JSON.parse(await readFile(turnstileConfigPath(env), "utf8")) as Partial<TurnstileConfig>;
    return {
      enabled: value.enabled === true,
      siteKey: typeof value.siteKey === "string" ? value.siteKey.trim() : "",
      secretKey: typeof value.secretKey === "string" ? value.secretKey.trim() : "",
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { ...EMPTY_TURNSTILE_CONFIG };
    throw error;
  }
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
  env = process.env,
): Promise<TurnstileConfig> {
  const current = await readTurnstileConfig(env);
  const next = mergeTurnstileConfig(current, update);
  const path = turnstileConfigPath(env);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
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
