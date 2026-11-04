import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AppServerPeer } from "../app-server-peer";
import { ApiKeyStore } from "../api-key-store";
import { JulesSessionStore, type JulesApiSessionMetadata } from "../jules-session-store";
import { parseRuntimeBrokerConfig } from "../runtime-broker-config";
import { RuntimeBrokerClient } from "../runtime-broker-client";
import { hashBrokerPassword } from "../runtime-broker-password";
import { createRuntimeBrokerServer } from "../runtime-broker-server";
import type { UserRuntimeServer } from "../user-runtime-registry";
import type { JsonRpcMessage } from "../../src/codex/protocol/json-rpc";

const servers: Array<{ close: () => Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

function fakeRuntime(): UserRuntimeServer {
  return {
    pid: 43210,
    attach: vi.fn<(peer: AppServerPeer) => void>(),
    detach: vi.fn<(peer: AppServerPeer) => void>(),
    handleClientMessage: vi.fn<(peer: AppServerPeer, message: JsonRpcMessage) => void>(),
    broadcast: vi.fn<(message: JsonRpcMessage, excludedPeer?: AppServerPeer) => void>(),
    close: vi.fn<() => void>(),
  };
}

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "codex-web-broker-api-keys-"));
  const passwordHash = await hashBrokerPassword("correct-password");
  const config = parseRuntimeBrokerConfig({
    version: 1,
    sessionSecret: "0123456789abcdef0123456789abcdef",
    codexCommand: "/usr/local/bin/codex",
    disconnectGraceMs: 0,
    users: [{
      id: "codex",
      email: "codex@example.com",
      passwordHash,
      osUser: "codex",
      home: "/home/codex",
      codexHome: "/home/codex/.codex",
      cwd: "/home/codex/workspace",
      role: "user",
      enabled: true,
      allowRoot: false,
    }],
  });
  const apiKeyStore = new ApiKeyStore(join(directory, "api-keys.json"));
  const apiSessionStore = new JulesSessionStore(join(directory, "api-sessions.json"));
  const server = await createRuntimeBrokerServer({
    socketPath: join(directory, "broker.sock"),
    config,
    createRuntime: () => fakeRuntime(),
    apiKeyStore,
    apiSessionStore,
  });
  servers.push(server);
  return {
    directory,
    config,
    server,
    apiKeyStore,
    apiSessionStore,
    client: new RuntimeBrokerClient(join(directory, "broker.sock")),
  };
}

async function loginAndCreateKey(client: RuntimeBrokerClient) {
  const login = await client.login("codex@example.com", "correct-password");
  const created = await client.createApiKey(login.token, "CI", "workspace", "binding-v1");
  return { login, created };
}

describe("runtime broker API keys", () => {
  it("manages keys with session auth and attaches the same user with an API key", async () => {
    const { client } = await fixture();
    const { login, created } = await loginAndCreateKey(client);

    await expect(client.listApiKeys("forged-token")).rejects.toThrow("登录已失效");
    await expect(client.listApiKeys(login.token)).resolves.toEqual([created.metadata]);
    await expect(client.verifyApiKey(created.key, "binding-v1")).resolves.toMatchObject({
      user: { id: "codex" },
      permissionProfile: "workspace",
    });
    await expect(client.verifyApiKey(created.key, "changed-binding")).rejects.toThrow("API key 无效");

    const connection = await client.attachApiRuntime(created.key, "binding-v1");
    expect(connection.permissionProfile).toBe("workspace");
    expect(connection.user.id).toBe("codex");
    connection.close();

    await client.revokeApiKey(login.token, created.metadata.id);
    await expect(client.verifyApiKey(created.key, "binding-v1")).rejects.toThrow("API key 无效");
    await expect(client.attachApiRuntime(created.key, "binding-v1")).rejects.toThrow("登录已失效");
  });

  it("limits each user to three keys and reports it as a rate limit", async () => {
    const { client } = await fixture();
    const login = await client.login("codex@example.com", "correct-password");
    for (let index = 0; index < 3; index += 1) {
      await client.createApiKey(login.token, `Key ${index}`, "workspace", "binding-v1");
    }
    await expect(client.createApiKey(login.token, "Fourth", "workspace", "binding-v1"))
      .rejects.toMatchObject({ code: "rate_limited" });
  });

  it("invalidates keys after credential or account changes", async () => {
    const { client, config, server } = await fixture();
    const { created } = await loginAndCreateKey(client);
    server.reload(
      { ...config, sessionSecret: "abcdef0123456789abcdef0123456789" },
      () => fakeRuntime(),
    );
    await expect(client.verifyApiKey(created.key, "binding-v1")).rejects.toThrow("API key 无效");
  });

  it("invalidates keys when the broker user is disabled", async () => {
    const { client, config, server } = await fixture();
    const { created } = await loginAndCreateKey(client);
    server.reload({
      ...config,
      users: [{ ...config.users[0]!, enabled: false }],
    }, () => fakeRuntime());
    await expect(client.verifyApiKey(created.key, "binding-v1")).rejects.toThrow("API key 无效");
  });

  it("performs API-session metadata operations only through API-key auth", async () => {
    const { client, directory } = await fixture();
    const { login, created } = await loginAndCreateKey(client);
    const metadata: JulesApiSessionMetadata = {
      threadId: "thread-1",
      userId: "codex",
      sourceId: "workspace-abc",
      prompt: "Build",
      title: "Build",
      requirePlanApproval: true,
      approvedPlanTurnId: null,
      approvedPlanAt: null,
    };
    await expect(client.upsertJulesSession("invalid", "binding-v1", metadata))
      .rejects.toThrow("API key 无效");
    await expect(client.upsertJulesSession(created.key, "binding-v1", {
      ...metadata,
      userId: "other-user",
    })).rejects.toThrow("不能为其他账号创建 API Session");
    await expect(client.upsertJulesSession(created.key, "binding-v1", metadata)).resolves.toEqual(metadata);
    await expect(client.listJulesSessions(created.key, "binding-v1")).resolves.toEqual([metadata]);
    await expect(client.approveJulesSessionPlan(
      created.key,
      "binding-v1",
      "thread-1",
      "turn-1",
      "2026-11-04T10:00:00.000Z",
    )).resolves.toMatchObject({ approvedPlanTurnId: "turn-1" });
    await expect(client.deleteJulesSession(created.key, "binding-v1", "thread-1")).resolves.toBe(true);
    await expect(client.getJulesSession(created.key, "binding-v1", "thread-1")).resolves.toBeNull();
    expect(login.token).toBeTruthy();
    expect(directory).toBeTruthy();
  });
});
