import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { chmod, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { turnstileStateDirectory } from "./turnstile-config";

export type ApiKeyPermissionProfile = "workspace" | "full_access";

export type PublicApiKey = {
  id: string;
  name: string;
  prefix: string;
  permissionProfile: ApiKeyPermissionProfile;
  createdAt: string;
  lastUsedAt: string | null;
};

export type ApiKeyVerification = PublicApiKey & {
  userId: string;
  authBinding: string;
  userCredentialVersion: string;
};

type StoredApiKey = ApiKeyVerification & {
  keyHash: string;
};

type ApiKeyFile = {
  version: 1;
  keys: StoredApiKey[];
};

type CreateApiKeyOptions = {
  userId: string;
  name: string;
  permissionProfile: ApiKeyPermissionProfile;
  authBinding: string;
  userCredentialVersion: string;
};

type ApiKeyStoreOptions = {
  expectedOwnerUid?: number;
  now?: () => Date;
};

export const MAX_API_KEYS_PER_USER = 3;
export const API_KEY_PREFIX = "cwk1";

const KEY_ID_BYTES = 8;
const KEY_SECRET_BYTES = 32;
const DUMMY_KEY_HASH = createHash("sha256").update("codex-web-invalid-api-key").digest();
const fileLocks = new Map<string, Promise<unknown>>();

export function apiKeyStatePath(
  env: NodeJS.ProcessEnv | Readonly<Record<string, string | undefined>> = process.env,
  home = homedir(),
): string {
  return join(turnstileStateDirectory(env, home), "api-keys.json");
}

export class ApiKeyStore {
  private readonly now: () => Date;

  constructor(
    private readonly path: string,
    private readonly options: ApiKeyStoreOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
  }

  async list(userId: string): Promise<PublicApiKey[]> {
    const file = await this.readFile();
    return file.keys
      .filter((key) => key.userId === userId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .map(publicKey);
  }

  async create(input: CreateApiKeyOptions): Promise<{ key: string; metadata: PublicApiKey }> {
    const name = input.name.trim();
    if (!name || name.length > 64) throw new Error("API key name must be between 1 and 64 characters");
    if (!isPermissionProfile(input.permissionProfile)) throw new Error("Invalid API key permission profile");
    if (!input.authBinding) throw new Error("API key auth binding is required");
    if (!input.userCredentialVersion) throw new Error("API key user credential version is required");

    return this.withLock(async () => {
      const file = await this.readFile();
      const owned = file.keys.filter((key) => key.userId === input.userId);
      if (owned.length >= MAX_API_KEYS_PER_USER) {
        throw new ApiKeyLimitError(MAX_API_KEYS_PER_USER);
      }

      // Hex keeps the public id unambiguous with the `_` separators in the
      // user-facing key format. Existing base64url ids remain verifiable.
      const id = randomBytes(KEY_ID_BYTES).toString("hex");
      const secret = randomBytes(KEY_SECRET_BYTES).toString("base64url");
      const key = `${API_KEY_PREFIX}_${id}_${secret}`;
      const stored: StoredApiKey = {
        id,
        name,
        prefix: `${API_KEY_PREFIX}_${id.slice(0, 6)}`,
        permissionProfile: input.permissionProfile,
        userId: input.userId,
        authBinding: input.authBinding,
        userCredentialVersion: input.userCredentialVersion,
        keyHash: hashKeyHex(key),
        createdAt: this.now().toISOString(),
        lastUsedAt: null,
      };
      file.keys.push(stored);
      await this.writeFile(file);
      return { key, metadata: publicKey(stored) };
    });
  }

  async revoke(userId: string, id: string): Promise<boolean> {
    return this.withLock(async () => {
      const file = await this.readFile();
      const index = file.keys.findIndex((key) => key.userId === userId && key.id === id);
      if (index < 0) return false;
      file.keys.splice(index, 1);
      await this.writeFile(file);
      return true;
    });
  }

  async verify(
    rawKey: string,
    expected: { authBinding: string; userCredentialVersion: (userId: string) => string | null },
  ): Promise<ApiKeyVerification | null> {
    const parsed = parseApiKey(rawKey);
    const file = await this.readFile();
    const stored = parsed ? file.keys.find((key) => key.id === parsed.id) : undefined;
    const candidateHash = hashKeyBytes(rawKey);
    const expectedHash = stored ? Buffer.from(stored.keyHash, "hex") : DUMMY_KEY_HASH;
    if (!timingSafeEqual(candidateHash, expectedHash) || !stored) return null;
    if (stored.authBinding !== expected.authBinding) return null;
    const currentCredentialVersion = expected.userCredentialVersion(stored.userId);
    if (!currentCredentialVersion || currentCredentialVersion !== stored.userCredentialVersion) return null;

    const observedAt = this.now();
    if (!shouldTouchLastUsed(stored.lastUsedAt, observedAt.getTime())) {
      return verification(stored);
    }
    return await this.withLock(async () => {
      const current = await this.readFile();
      const target = current.keys.find((key) => key.id === stored.id && key.userId === stored.userId);
      if (!target) return null;
      target.lastUsedAt = observedAt.toISOString();
      await this.writeFile(current);
      return verification(target);
    });
  }

  private async readFile(): Promise<ApiKeyFile> {
    let contents: string;
    try {
      const fileStat = await stat(this.path);
      assertSecurePermissions(fileStat.mode, this.options.expectedOwnerUid, fileStat.uid);
      contents = await readFile(this.path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, keys: [] };
      throw error;
    }
    return parseApiKeyFile(contents);
  }

  private async writeFile(file: ApiKeyFile): Promise<void> {
    const directory = dirname(this.path);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const temporaryPath = `${this.path}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(file, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    await rename(temporaryPath, this.path);
    await chmod(this.path, 0o600);
  }

  private async withLock<T>(operation: () => Promise<T>): Promise<T> {
    const previous = fileLocks.get(this.path) ?? Promise.resolve();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queueEntry = previous.catch(() => undefined).then(() => gate);
    fileLocks.set(this.path, queueEntry);
    await previous.catch(() => undefined);
    try {
      return await operation();
    } finally {
      release();
      if (fileLocks.get(this.path) === queueEntry) fileLocks.delete(this.path);
    }
  }
}

export class ApiKeyLimitError extends Error {
  constructor(readonly limit: number) {
    super(`At most ${limit} API keys can be active per account`);
    this.name = "ApiKeyLimitError";
  }
}

export function parseApiKey(rawKey: string): { id: string; secret: string } | null {
  const match = /^cwk1_([A-Za-z0-9_-]{16})_([A-Za-z0-9_-]{43})$/.exec(rawKey);
  return match ? { id: match[1], secret: match[2] } : null;
}

export function isApiKeyPermissionProfile(value: unknown): value is ApiKeyPermissionProfile {
  return value === "workspace" || value === "full_access";
}

function parseApiKeyFile(contents: string): ApiKeyFile {
  const parsed = JSON.parse(contents) as Partial<ApiKeyFile>;
  if (parsed.version !== 1 || !Array.isArray(parsed.keys)) {
    throw new Error("Invalid API key store format");
  }
  const keys = parsed.keys.map((key, index) => parseStoredKey(key, index));
  const ids = new Set<string>();
  for (const key of keys) {
    if (ids.has(key.id)) throw new Error("Duplicate API key id in store");
    ids.add(key.id);
  }
  return { version: 1, keys };
}

function parseStoredKey(value: unknown, index: number): StoredApiKey {
  if (!value || typeof value !== "object") throw new Error(`Invalid API key entry at index ${index}`);
  const key = value as Partial<StoredApiKey>;
  if (
    typeof key.id !== "string"
    || typeof key.name !== "string"
    || typeof key.prefix !== "string"
    || typeof key.userId !== "string"
    || typeof key.authBinding !== "string"
    || typeof key.userCredentialVersion !== "string"
    || typeof key.keyHash !== "string"
    || typeof key.createdAt !== "string"
    || (key.lastUsedAt !== null && typeof key.lastUsedAt !== "string")
    || !isApiKeyPermissionProfile(key.permissionProfile)
    || !/^[a-f0-9]{64}$/.test(key.keyHash)
  ) {
    throw new Error(`Invalid API key entry at index ${index}`);
  }
  return key as StoredApiKey;
}

function assertSecurePermissions(mode: number, expectedOwnerUid: number | undefined, ownerUid: number): void {
  if ((mode & 0o077) !== 0) throw new Error("API key store must have 0600 permissions");
  if (expectedOwnerUid !== undefined && ownerUid !== expectedOwnerUid) {
    throw new Error("API key store owner does not match the expected user");
  }
}

function hashKeyBytes(key: string): Buffer {
  return createHash("sha256").update(key).digest();
}

function hashKeyHex(key: string): string {
  return hashKeyBytes(key).toString("hex");
}

function publicKey(key: StoredApiKey): PublicApiKey {
  return {
    id: key.id,
    name: key.name,
    prefix: key.prefix,
    permissionProfile: key.permissionProfile,
    createdAt: key.createdAt,
    lastUsedAt: key.lastUsedAt,
  };
}

function verification(key: StoredApiKey): ApiKeyVerification {
  return {
    ...publicKey(key),
    userId: key.userId,
    authBinding: key.authBinding,
    userCredentialVersion: key.userCredentialVersion,
  };
}

function shouldTouchLastUsed(lastUsedAt: string | null, now: number): boolean {
  if (!lastUsedAt) return true;
  const previous = Date.parse(lastUsedAt);
  return !Number.isFinite(previous) || now - previous >= 60_000;
}

function isPermissionProfile(value: unknown): value is ApiKeyPermissionProfile {
  return value === "workspace" || value === "full_access";
}
