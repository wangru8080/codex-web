import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createSessionToken, readWebAuthConfig, WEB_AUTH_COOKIE } from "../../../../../server/web-auth";
import { DELETE } from "./[id]/route";
import { GET, POST } from "./route";

const directories: string[] = [];

beforeEach(async () => {
  const state = await mkdtemp(join(tmpdir(), "codex-web-settings-api-keys-"));
  directories.push(state);
  vi.stubEnv("CODEX_WEB_AUTH_MODE", "local");
  vi.stubEnv("CODEX_WEB_STATE", state);
  vi.stubEnv("CODEX_WEB_LOGIN_EMAIL", "test@admin.com");
  vi.stubEnv("CODEX_WEB_LOGIN_PASSWORD", "123456");
  vi.stubEnv("CODEX_WEB_SESSION_SECRET", "0123456789abcdef0123456789abcdef");
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("API key Settings routes", () => {
  it("requires a browser session and same-origin write", async () => {
    const unauthorized = await GET(new NextRequest("http://localhost:3000/api/settings/api-keys"));
    expect(unauthorized.status).toBe(401);
    expect(unauthorized.headers.get("cache-control")).toContain("no-store");

    const crossOrigin = await POST(new NextRequest("http://localhost:3000/api/settings/api-keys", {
      method: "POST",
      headers: authHeaders({ origin: "https://evil.example" }),
      body: JSON.stringify({ name: "CI", permissionProfile: "workspace" }),
    }));
    expect(crossOrigin.status).toBe(403);
  });

  it("shows the raw key once, lists metadata only, and revokes immediately", async () => {
    const created = await POST(new NextRequest("http://localhost:3000/api/settings/api-keys", {
      method: "POST",
      headers: authHeaders({ origin: "http://localhost:3000" }),
      body: JSON.stringify({ name: "CI", permissionProfile: "workspace" }),
    }));
    expect(created.status).toBe(200);
    expect(created.headers.get("cache-control")).toContain("no-store");
    const createdBody = await created.json() as {
      key: string;
      metadata: { id: string; name: string; prefix: string; permissionProfile: string };
    };
    expect(createdBody.key).toMatch(/^cwk1_[a-f0-9]{16}_[A-Za-z0-9_-]{43}$/);
    expect(createdBody.metadata).toMatchObject({
      name: "CI",
      prefix: expect.stringMatching(/^cwk1_[a-f0-9]{6}$/),
      permissionProfile: "workspace",
    });
    expect(createdBody.metadata).not.toHaveProperty("keyHash");

    const listed = await GET(new NextRequest("http://localhost:3000/api/settings/api-keys", {
      headers: authHeaders(),
    }));
    const listedText = await listed.text();
    expect(listed.status).toBe(200);
    expect(listedText).not.toContain(createdBody.key);
    expect(JSON.parse(listedText)).toMatchObject({
      keys: [{ id: createdBody.metadata.id, name: "CI", permissionProfile: "workspace" }],
    });

    const revoked = await DELETE(new NextRequest(
      `http://localhost:3000/api/settings/api-keys/${createdBody.metadata.id}`,
      { method: "DELETE", headers: authHeaders({ origin: "http://localhost:3000" }) },
    ), { params: Promise.resolve({ id: createdBody.metadata.id }) });
    expect(revoked.status).toBe(200);

    const afterRevoke = await GET(new NextRequest("http://localhost:3000/api/settings/api-keys", {
      headers: authHeaders(),
    }));
    await expect(afterRevoke.json()).resolves.toEqual({ keys: [] });
  });
});

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const token = createSessionToken(readWebAuthConfig(process.env));
  return {
    cookie: `${WEB_AUTH_COOKIE}=${token}`,
    "content-type": "application/json",
    ...extra,
  };
}

