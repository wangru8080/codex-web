import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "./route";

const SESSION_SECRET = "0123456789abcdef0123456789abcdef";
const ISSUER = "https://idp.example.test";

describe("SSO login redirect", () => {
  beforeEach(() => {
    vi.stubEnv("CODEX_WEB_AUTH_MODE", "sso");
    vi.stubEnv("CODEX_WEB_OIDC_ISSUER", ISSUER);
    vi.stubEnv("CODEX_WEB_OIDC_CLIENT_ID", "client-id");
    vi.stubEnv("CODEX_WEB_OIDC_CLIENT_SECRET", "client-secret");
    vi.stubEnv("CODEX_WEB_SESSION_SECRET", SESSION_SECRET);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("starts a fresh OIDC flow with an uncacheable redirect and state cookie", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      issuer: ISSUER,
      authorization_endpoint: `${ISSUER}/authorize`,
      token_endpoint: `${ISSUER}/token`,
      jwks_uri: `${ISSUER}/jwks`,
    }), { status: 200 })));

    const response = await GET(new NextRequest(
      "http://localhost:3000/api/auth/sso/login?next=%2Fchat%3Fthread%3Dold&cacheBust=login-1",
    ));

    expect(response.status).toBe(307);
    const location = new URL(response.headers.get("location") ?? "");
    expect(location.origin).toBe(ISSUER);
    expect(location.pathname).toBe("/authorize");
    expect(location.searchParams.get("state")).toBeTruthy();
    expect(location.searchParams.get("nonce")).toBeTruthy();
    expect(location.searchParams.get("code_challenge_method")).toBe("S256");
    expect(response.headers.get("cache-control")).toBe("no-store, max-age=0");
    expect(response.headers.get("pragma")).toBe("no-cache");

    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("codex_web_oidc_state=");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=lax");
    expect(setCookie).toContain("Max-Age=600");
  });

  it("also prevents caching when OIDC discovery fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("unavailable", { status: 503 })));

    const response = await GET(new NextRequest(
      "http://localhost:3000/api/auth/sso/login?next=%2Fchat%3Fthread%3Dold&cacheBust=login-2",
    ));

    expect(response.status).toBe(307);
    const location = new URL(response.headers.get("location") ?? "");
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("next")).toBe("/chat?thread=old");
    expect(location.searchParams.get("error")).toContain("OIDC discovery");
    expect(response.headers.get("cache-control")).toBe("no-store, max-age=0");
    expect(response.headers.get("pragma")).toBe("no-cache");
  });
});
