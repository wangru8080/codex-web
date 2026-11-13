import { existsSync, readFileSync } from "node:fs";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";
import { homedir } from "node:os";

import { turnstileStateDirectory } from "./turnstile-config";

export type WebAuthMode = "local" | "sso";

export type SsoConfig = {
  enabled: boolean;
  providerName: string;
  issuer: string;
  clientId: string;
  clientSecret: string;
  scopes: string;
  allowedEmails: string[];
  allowedDomains: string[];
};

export type SsoConfigUpdate = {
  enabled: boolean;
  providerName?: string;
  issuer: string;
  clientId: string;
  clientSecret?: string;
  scopes?: string;
  allowedEmails?: string[] | string;
  allowedDomains?: string[] | string;
};

export type PublicSsoConfig = {
  enabled: boolean;
  providerName: string;
  issuer: string;
  clientId: string;
  clientSecretConfigured: boolean;
  scopes: string;
  allowedEmails: string[];
  allowedDomains: string[];
};

type SsoEnvironment = Readonly<Record<string, string | undefined>>;

export const DEFAULT_OIDC_SCOPES = "openid email profile";

export const EMPTY_SSO_CONFIG: SsoConfig = {
  enabled: false,
  providerName: "SSO",
  issuer: "",
  clientId: "",
  clientSecret: "",
  scopes: DEFAULT_OIDC_SCOPES,
  allowedEmails: [],
  allowedDomains: [],
};

export function ssoConfigPath(env: SsoEnvironment = process.env, home = homedir()): string {
  return join(turnstileStateDirectory(env, home), "sso.json");
}

function shouldReadDefaultDiskConfig(env: SsoEnvironment): boolean {
  if (env.CODEX_WEB_STATE?.trim()) return true;
  if (env.VITEST === "true" || process.env.VITEST === "true" || env.NODE_ENV === "test") {
    return false;
  }
  return env === process.env;
}

export async function readSsoConfig(
  env: SsoEnvironment = process.env,
  home?: string,
): Promise<SsoConfig> {
  const canReadDisk = home !== undefined || shouldReadDefaultDiskConfig(env);
  const diskConfig = canReadDisk
    ? await readSsoConfigAt(ssoConfigPath(env, home ?? homedir()))
    : { ...EMPTY_SSO_CONFIG };
  return applyEnvOverrides(diskConfig, env);
}

export function readSsoConfigSync(
  env: SsoEnvironment = process.env,
  home?: string,
): SsoConfig {
  const canReadDisk = home !== undefined || shouldReadDefaultDiskConfig(env);
  const path = ssoConfigPath(env, home ?? homedir());
  let diskConfig: SsoConfig = { ...EMPTY_SSO_CONFIG };
  if (canReadDisk && existsSync(path)) {
    try {
      diskConfig = parseSsoConfig(readFileSync(path, "utf8"));
    } catch {
      diskConfig = { ...EMPTY_SSO_CONFIG };
    }
  }
  return applyEnvOverrides(diskConfig, env);
}

export async function readSsoConfigAt(path: string): Promise<SsoConfig> {
  try {
    return parseSsoConfig(await readFile(path, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return { ...EMPTY_SSO_CONFIG };
}

function parseSsoConfig(contents: string): SsoConfig {
  const value = JSON.parse(contents) as Partial<Record<keyof SsoConfig, unknown>>;
  return {
    enabled: value.enabled === true,
    providerName: typeof value.providerName === "string" && value.providerName.trim()
      ? value.providerName.trim()
      : "SSO",
    issuer: typeof value.issuer === "string" ? normalizeIssuerUrl(value.issuer) : "",
    clientId: typeof value.clientId === "string" ? value.clientId.trim() : "",
    clientSecret: typeof value.clientSecret === "string" ? value.clientSecret.trim() : "",
    scopes: typeof value.scopes === "string" && value.scopes.trim()
      ? value.scopes.trim()
      : DEFAULT_OIDC_SCOPES,
    allowedEmails: normalizeList(value.allowedEmails),
    allowedDomains: normalizeList(value.allowedDomains).map((d) => d.replace(/^@+/, "")),
  };
}

function applyEnvOverrides(base: SsoConfig, env: SsoEnvironment): SsoConfig {
  const modeEnv = env.CODEX_WEB_AUTH_MODE?.trim().toLowerCase();
  const enabled = modeEnv === "sso"
    ? true
    : modeEnv === "local"
      ? false
      : base.enabled;
  const providerName = env.CODEX_WEB_OIDC_PROVIDER_NAME?.trim() || base.providerName || "SSO";
  const issuer = env.CODEX_WEB_OIDC_ISSUER?.trim()
    ? normalizeIssuerUrl(env.CODEX_WEB_OIDC_ISSUER)
    : base.issuer;
  const clientId = env.CODEX_WEB_OIDC_CLIENT_ID?.trim() || base.clientId;
  const clientSecret = env.CODEX_WEB_OIDC_CLIENT_SECRET?.trim() || base.clientSecret;
  const scopes = env.CODEX_WEB_OIDC_SCOPES?.trim() || base.scopes || DEFAULT_OIDC_SCOPES;
  const allowedEmails = env.CODEX_WEB_OIDC_ALLOWED_EMAILS !== undefined
    ? normalizeList(env.CODEX_WEB_OIDC_ALLOWED_EMAILS)
    : base.allowedEmails;
  const allowedDomains = env.CODEX_WEB_OIDC_ALLOWED_DOMAINS !== undefined
    ? normalizeList(env.CODEX_WEB_OIDC_ALLOWED_DOMAINS).map((d) => d.replace(/^@+/, ""))
    : base.allowedDomains;

  return {
    enabled,
    providerName,
    issuer,
    clientId,
    clientSecret,
    scopes,
    allowedEmails,
    allowedDomains,
  };
}

export function normalizeIssuerUrl(issuer: string): string {
  return issuer
    .trim()
    .replace(/\/\.well-known\/openid-configuration\/?$/i, "")
    .replace(/\/+$/, "");
}

function normalizeList(input: unknown): string[] {
  const rawItems: string[] = Array.isArray(input)
    ? input.filter((item): item is string => typeof item === "string")
    : typeof input === "string"
      ? input.split(/[,\n;]/)
      : [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of rawItems) {
    const normalized = item.trim().toLowerCase();
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      result.push(normalized);
    }
  }
  return result;
}

export function mergeSsoConfig(current: SsoConfig, update: SsoConfigUpdate): SsoConfig {
  const next: SsoConfig = {
    enabled: update.enabled === true,
    providerName: update.providerName?.trim() || current.providerName || "SSO",
    issuer: normalizeIssuerUrl(update.issuer ?? current.issuer),
    clientId: (update.clientId ?? current.clientId).trim(),
    clientSecret: update.clientSecret?.trim() || current.clientSecret,
    scopes: update.scopes?.trim() || current.scopes || DEFAULT_OIDC_SCOPES,
    allowedEmails: update.allowedEmails !== undefined
      ? normalizeList(update.allowedEmails)
      : current.allowedEmails,
    allowedDomains: update.allowedDomains !== undefined
      ? normalizeList(update.allowedDomains).map((d) => d.replace(/^@+/, ""))
      : current.allowedDomains,
  };
  if (next.enabled) {
    if (!next.issuer) throw new Error("OIDC Issuer URL is required before enabling SSO");
    try {
      const parsed = new URL(next.issuer);
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
        throw new Error("invalid protocol");
      }
    } catch {
      throw new Error("OIDC Issuer URL must be a valid HTTP/HTTPS URL");
    }
    if (!next.clientId) throw new Error("OIDC Client ID is required before enabling SSO");
    if (!next.clientSecret) throw new Error("OIDC Client Secret is required before enabling SSO");
  }
  return next;
}

export async function writeSsoConfig(
  update: SsoConfigUpdate,
  env: SsoEnvironment = process.env,
  home = homedir(),
): Promise<SsoConfig> {
  return writeSsoConfigAt(update, ssoConfigPath(env, home));
}

export async function writeSsoConfigAt(
  update: SsoConfigUpdate,
  path: string,
): Promise<SsoConfig> {
  const current = await readSsoConfigAt(path);
  const next = mergeSsoConfig(current, update);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await chmod(dirname(path), 0o700);
  const temporaryPath = `${path}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(next, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });
  await rename(temporaryPath, path);
  await chmod(path, 0o600);
  return next;
}

export function publicSsoConfig(config: SsoConfig): PublicSsoConfig {
  return {
    enabled: config.enabled,
    providerName: config.providerName || "SSO",
    issuer: config.issuer,
    clientId: config.clientId,
    clientSecretConfigured: config.clientSecret.length > 0,
    scopes: config.scopes || DEFAULT_OIDC_SCOPES,
    allowedEmails: config.allowedEmails,
    allowedDomains: config.allowedDomains,
  };
}

export function isEmailAllowedBySsoConfig(email: string, config: SsoConfig): boolean {
  const normalized = email.trim().toLowerCase();
  if (!normalized || !normalized.includes("@")) return false;
  if (config.allowedEmails.length === 0 && config.allowedDomains.length === 0) {
    return true;
  }
  if (config.allowedEmails.includes(normalized)) {
    return true;
  }
  const atIndex = normalized.lastIndexOf("@");
  const domain = atIndex > 0 ? normalized.slice(atIndex + 1) : "";
  if (domain && config.allowedDomains.includes(domain)) {
    return true;
  }
  return false;
}
