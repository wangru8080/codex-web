import { createSign, generateKeyPairSync } from "node:crypto";

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createOidcStateToken,
  generatePkcePair,
  WEB_OIDC_STATE_COOKIE,
} from "../../../../../../server/oidc";
import { GET } from "./route";

const SESSION_SECRET = "0123456789abcdef0123456789abcdef";
const ISSUER = "https://idp.example.test";
const DISCOVERY = {
  issuer: ISSUER,
  authorization_endpoint: `${ISSUER}/authorize`,
  token_endpoint: `${ISSUER}/token`,
  jwks_uri: `${ISSUER}/jwks`,
};

describe("SSO callback redirect", () => {
  beforeEach(() => {
    vi.stubEnv("CODEX_WEB_AUTH_MODE", "sso");
    vi.stubEnv("CODEX_WEB_OIDC_ISSUER", ISSUER);
    vi.stubEnv("CODEX_WEB_OIDC_CLIENT_ID", "client-id");
    vi.stubEnv("CODEX_WEB_OIDC_CLIENT_SECRET", "client-secret");
    vi.stubEnv("CODEX_WEB_OIDC_ALLOWED_EMAILS", "user@example.test");
    vi.stubEnv("CODEX_WEB_SESSION_SECRET", SESSION_SECRET);
    vi.stubEnv("CODEX_WEB_RUNTIME_BROKER_SOCKET", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("sets the session cookie and returns an uncacheable success redirect", async () => {
    const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const publicJwk = {
      ...(publicKey.export({ format: "jwk" }) as Record<string, unknown>),
      kid: "key-1",
      alg: "RS256",
      use: "sig",
      kty: "RSA",
    };
    const pkce = generatePkcePair();
    const stateToken = createOidcStateToken({
      state: "state-1",
      nonce: "nonce-1",
      codeVerifier: pkce.codeVerifier,
      redirectUri: "http://localhost:3000/api/auth/sso/callback",
      next: "/settings/security?tab=sso",
    }, SESSION_SECRET);

    const nowSeconds = Math.floor(Date.now() / 1_000);
    const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT", kid: "key-1" })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({
      iss: ISSUER,
      sub: "user-sub-1",
      aud: "client-id",
      exp: nowSeconds + 300,
      iat: nowSeconds,
      nonce: "nonce-1",
      email: "user@example.test",
    })).toString("base64url");
    const signer = createSign("RSA-SHA256");
    signer.update(`${header}.${payload}`);
    const idToken = `${header}.${payload}.${signer.sign(privateKey).toString("base64url")}`;

    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url === `${ISSUER}/.well-known/openid-configuration`) {
        return new Response(JSON.stringify(DISCOVERY), { status: 200 });
      }
      if (url === DISCOVERY.token_endpoint) {
        return new Response(JSON.stringify({ id_token: idToken }), { status: 200 });
      }
      if (url === DISCOVERY.jwks_uri) {
        return new Response(JSON.stringify({ keys: [publicJwk] }), { status: 200 });
      }
      return new Response("not found", { status: 404 });
    }));

    const response = await GET(new NextRequest(
      "http://localhost:3000/api/auth/sso/callback?code=code-1&state=state-1",
      { headers: { cookie: `${WEB_OIDC_STATE_COOKIE}=${stateToken}` } },
    ));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost:3000/settings/security?tab=sso");
    expect(response.headers.get("cache-control")).toBe("no-store, max-age=0");
    expect(response.headers.get("pragma")).toBe("no-cache");
    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("codex_web_session=");
    expect(setCookie).toContain("Max-Age=259200");
    expect(setCookie).toContain(`${WEB_OIDC_STATE_COOKIE}=;`);
  });

  it("prevents caching provider failures", async () => {
    const response = await GET(new NextRequest(
      "http://localhost:3000/api/auth/sso/callback?error=access_denied&error_description=Denied",
    ));

    expect(response.status).toBe(307);
    const location = new URL(response.headers.get("location") ?? "");
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("error")).toContain("Denied");
    expect(response.headers.get("cache-control")).toBe("no-store, max-age=0");
    expect(response.headers.get("pragma")).toBe("no-cache");
  });
});
