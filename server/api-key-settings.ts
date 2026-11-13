import { ApiKeyLimitError, ApiKeyStore, apiKeyStatePath, isApiKeyPermissionProfile, type ApiKeyPermissionProfile, type PublicApiKey } from "./api-key-store";
import { BrokerClientError, RuntimeBrokerClient } from "./runtime-broker-client";
import {
  readWebAuthBinding,
  runtimeBrokerSocket,
  webAuthCredentialVersion,
} from "./web-auth";
import type { BrokerPublicUser } from "./runtime-broker-protocol";

export type ApiKeySettingsEnv = NodeJS.ProcessEnv | Record<string, string | undefined>;

export async function listApiKeysForUser(
  user: BrokerPublicUser,
  sessionToken: string | undefined,
  env: ApiKeySettingsEnv = process.env,
): Promise<PublicApiKey[]> {
  const brokerSocket = runtimeBrokerSocket(env);
  if (brokerSocket) {
    if (!sessionToken) throw new ApiKeySettingsError(401, "登录已失效");
    return await new RuntimeBrokerClient(brokerSocket).listApiKeys(sessionToken);
  }
  return await new ApiKeyStore(apiKeyStatePath(env)).list(user.id);
}

export async function createApiKeyForUser(
  user: BrokerPublicUser,
  sessionToken: string | undefined,
  name: string,
  permissionProfile: ApiKeyPermissionProfile,
  env: ApiKeySettingsEnv = process.env,
): Promise<{ key: string; metadata: PublicApiKey }> {
  const normalizedName = validateApiKeyName(name);
  if (!isApiKeyPermissionProfile(permissionProfile)) {
    throw new ApiKeySettingsError(400, "Invalid API key permission profile");
  }
  const authBinding = readWebAuthBinding(env);
  const brokerSocket = runtimeBrokerSocket(env);
  if (brokerSocket) {
    if (!sessionToken) throw new ApiKeySettingsError(401, "登录已失效");
    try {
      return await new RuntimeBrokerClient(brokerSocket).createApiKey(
        sessionToken,
        normalizedName,
        permissionProfile,
        authBinding,
      );
    } catch (error) {
      throw brokerSettingsError(error, "API key 创建失败");
    }
  }
  const credentialVersion = webAuthCredentialVersion(env);
  if (!credentialVersion) throw new ApiKeySettingsError(401, "登录已失效");
  try {
    return await new ApiKeyStore(apiKeyStatePath(env)).create({
      userId: user.id,
      name: normalizedName,
      permissionProfile,
      authBinding,
      userCredentialVersion: credentialVersion,
    });
  } catch (error) {
    if (error instanceof ApiKeyLimitError) throw new ApiKeySettingsError(429, error.message);
    throw error;
  }
}

export async function revokeApiKeyForUser(
  user: BrokerPublicUser,
  sessionToken: string | undefined,
  id: string,
  env: ApiKeySettingsEnv = process.env,
): Promise<void> {
  if (!/^[A-Za-z0-9_-]{16}$/.test(id)) throw new ApiKeySettingsError(404, "API key 不存在");
  const brokerSocket = runtimeBrokerSocket(env);
  if (brokerSocket) {
    if (!sessionToken) throw new ApiKeySettingsError(401, "登录已失效");
    try {
      await new RuntimeBrokerClient(brokerSocket).revokeApiKey(sessionToken, id);
    } catch (error) {
      throw brokerSettingsError(error, "API key 撤销失败");
    }
    return;
  }
  const revoked = await new ApiKeyStore(apiKeyStatePath(env)).revoke(user.id, id);
  if (!revoked) throw new ApiKeySettingsError(404, "API key 不存在");
}

export class ApiKeySettingsError extends Error {
  constructor(readonly statusCode: number, message: string) {
    super(message);
    this.name = "ApiKeySettingsError";
  }
}

function validateApiKeyName(name: unknown): string {
  if (typeof name !== "string") throw new ApiKeySettingsError(400, "API key 名称不能为空");
  const normalized = name.trim();
  if (!normalized || normalized.length > 64) {
    throw new ApiKeySettingsError(400, "API key 名称长度必须为 1 到 64 个字符");
  }
  return normalized;
}

function brokerSettingsError(error: unknown, fallback: string): ApiKeySettingsError {
  if (error instanceof BrokerClientError) {
    if (error.code === "unauthorized") return new ApiKeySettingsError(401, "登录已失效");
    if (error.code === "rate_limited") return new ApiKeySettingsError(429, error.message);
    if (error.code === "invalid_request") return new ApiKeySettingsError(400, error.message);
  }
  return new ApiKeySettingsError(503, error instanceof Error ? error.message : fallback);
}
