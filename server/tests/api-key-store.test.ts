import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  ApiKeyLimitError,
  ApiKeyStore,
  parseApiKey,
} from "../api-key-store";

const authBinding = "auth-binding-v1";
const credentialVersion = "credential-v1";

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "codex-web-api-keys-"));
  const path = join(directory, "api-keys.json");
  let now = new Date("2026-11-04T10:00:00.000Z");
  const store = new ApiKeyStore(path, { now: () => now });
  return {
    path,
    store,
    advance: (milliseconds: number) => {
      now = new Date(now.getTime() + milliseconds);
    },
  };
}

describe("ApiKeyStore", () => {
  it("creates one-time keys, stores only a hash, and validates the secret", async () => {
    const { path, store } = await fixture();
    const created = await store.create({
      userId: "user-a",
      name: "CI",
      permissionProfile: "workspace",
      authBinding,
      userCredentialVersion: credentialVersion,
    });

    expect(created.key).toMatch(/^cwk1_[A-Za-z0-9_-]{16}_[A-Za-z0-9_-]{43}$/);
    expect(parseApiKey(created.key)).not.toBeNull();
    expect(created.metadata).toMatchObject({
      name: "CI",
      permissionProfile: "workspace",
      lastUsedAt: null,
    });
    expect(parseApiKey(created.key)).toMatchObject({
      id: created.metadata.id,
      secret: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
    });
    expect(created.metadata).toEqual({
      id: expect.stringMatching(/^[a-f0-9]{16}$/),
      name: "CI",
      prefix: expect.stringMatching(/^cwk1_[a-f0-9]{6}$/),
      permissionProfile: "workspace",
      createdAt: "2026-11-04T10:00:00.000Z",
      lastUsedAt: null,
    });
    expect(JSON.stringify(created.metadata)).not.toContain(created.key);
    const file = await readFile(path, "utf8");
    expect(file).not.toContain(created.key);
    expect((await stat(path)).mode & 0o777).toBe(0o600);

    await expect(store.verify(created.key, {
      authBinding,
      userCredentialVersion: () => credentialVersion,
    })).resolves.toMatchObject({ userId: "user-a", id: created.metadata.id });
    await expect(store.verify(`${created.key}x`, {
      authBinding,
      userCredentialVersion: () => credentialVersion,
    })).resolves.toBeNull();
  });

  it("rejects binding and credential changes and revokes immediately", async () => {
    const { store, advance } = await fixture();
    const created = await store.create({
      userId: "user-a",
      name: "CI",
      permissionProfile: "full_access",
      authBinding,
      userCredentialVersion: credentialVersion,
    });

    await expect(store.verify(created.key, {
      authBinding: "changed",
      userCredentialVersion: () => credentialVersion,
    })).resolves.toBeNull();
    await expect(store.verify(created.key, {
      authBinding,
      userCredentialVersion: () => "changed",
    })).resolves.toBeNull();
    await expect(store.verify(created.key, {
      authBinding,
      userCredentialVersion: () => credentialVersion,
    })).resolves.toMatchObject({ lastUsedAt: "2026-11-04T10:00:00.000Z" });

    advance(30_000);
    await expect(store.verify(created.key, {
      authBinding,
      userCredentialVersion: () => credentialVersion,
    })).resolves.toMatchObject({ lastUsedAt: "2026-11-04T10:00:00.000Z" });
    advance(31_000);
    await expect(store.verify(created.key, {
      authBinding,
      userCredentialVersion: () => credentialVersion,
    })).resolves.toMatchObject({ lastUsedAt: "2026-11-04T10:01:01.000Z" });

    expect(await store.revoke("another-user", created.metadata.id)).toBe(false);
    expect(await store.revoke("user-a", created.metadata.id)).toBe(true);
    await expect(store.verify(created.key, {
      authBinding,
      userCredentialVersion: () => credentialVersion,
    })).resolves.toBeNull();
  });

  it("enforces three active keys per user without affecting another user", async () => {
    const { store } = await fixture();
    for (let index = 0; index < 3; index += 1) {
      await store.create({
        userId: "user-a",
        name: `Key ${index}`,
        permissionProfile: "workspace",
        authBinding,
        userCredentialVersion: credentialVersion,
      });
    }
    await expect(store.create({
      userId: "user-a",
      name: "Fourth",
      permissionProfile: "workspace",
      authBinding,
      userCredentialVersion: credentialVersion,
    })).rejects.toBeInstanceOf(ApiKeyLimitError);
    await expect(store.create({
      userId: "user-b",
      name: "Allowed",
      permissionProfile: "workspace",
      authBinding,
      userCredentialVersion: credentialVersion,
    })).resolves.toMatchObject({ metadata: { name: "Allowed" } });
    expect(await store.list("user-a")).toHaveLength(3);
    expect(await store.list("user-b")).toHaveLength(1);
  });
});
