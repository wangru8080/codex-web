import { generateKeyPairSync, createSign } from "node:crypto";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  buildOidcAuthorizationUrl,
  createOidcStateToken,
  exchangeOidcAuthorizationCode,
  fetchOidcDiscovery,
  generatePkcePair,
  verifyOidcIdTokenAndExtractIdentity,
  verifyOidcStateToken,
  type OidcDiscoveryDocument,
} from "../oidc";
import {
  isEmailAllowedBySsoConfig,
  mergeSsoConfig,
  publicSsoConfig,
  readSsoConfig,
  ssoConfigPath,
  writeSsoConfig,
  type SsoConfig,
} from "../sso-config";
import {
  assertWebAuthStartupConfig,
  authenticateWebRequest,
  createSsoSessionToken,
  verifySsoSessionToken,
  WEB_AUTH_COOKIE,
} from "../web-auth";

const SESSION_SECRET = "0123456789abcdef0123456789abcdef";

const SAMPLE_SSO: SsoConfig = {
  enabled: true,
  providerName: "OIDC Provider",
  issuer: "https://idp.example.test/oidc/app-1",
  clientId: "client-id-123",
  clientSecret: "client-secret-456",
  scopes: "openid email profile",
  allowedEmails: ["admin@example.test"],
  allowedDomains: ["corp.example.test"],
};

describe("SSO configuration & OIDC authentication", () => {
  it("resolves sso.json inside CODEX_WEB_STATE or ~/.codex-web with 0600 permissions", async () => {
    const parent = await mkdtemp(join(tmpdir(), "codex-web-sso-write-"));
    const state = join(parent, "state");
    expect(ssoConfigPath({ CODEX_WEB_STATE: state }, "/ignored")).toBe(join(state, "sso.json"));

    const saved = await writeSsoConfig(
      {
        enabled: true,
        providerName: "Standard OIDC",
        issuer: "https://idp.example.test/oidc/.well-known/openid-configuration",
        clientId: "cid-1",
        clientSecret: "csec-1",
        allowedEmails: "Alice@Example.test, bob@example.test",
        allowedDomains: "@corp.example.test",
      },
      { CODEX_WEB_STATE: state },
      "/ignored",
    );

    expect(saved.issuer).toBe("https://idp.example.test/oidc");
    expect(saved.allowedEmails).toEqual(["alice@example.test", "bob@example.test"]);
    expect(saved.allowedDomains).toEqual(["corp.example.test"]);
    expect((await stat(state)).mode & 0o777).toBe(0o700);
    expect((await stat(join(state, "sso.json"))).mode & 0o777).toBe(0o600);

    const disk = JSON.parse(await readFile(join(state, "sso.json"), "utf8")) as SsoConfig;
    expect(disk.clientSecret).toBe("csec-1");
    expect(publicSsoConfig(saved)).toEqual({
      enabled: true,
      providerName: "Standard OIDC",
      issuer: "https://idp.example.test/oidc",
      clientId: "cid-1",
      clientSecretConfigured: true,
      scopes: "openid email profile",
      allowedEmails: ["alice@example.test", "bob@example.test"],
      allowedDomains: ["corp.example.test"],
    });
  });

  it("preserves existing clientSecret when saving with blank secret", () => {
    const merged = mergeSsoConfig(SAMPLE_SSO, {
      enabled: false,
      issuer: SAMPLE_SSO.issuer,
      clientId: SAMPLE_SSO.clientId,
      clientSecret: "",
    });
    expect(merged.clientSecret).toBe("client-secret-456");
    expect(merged.enabled).toBe(false);
  });

  it("applies CODEX_WEB_AUTH_MODE and CODEX_WEB_OIDC_* environment overrides", async () => {
    const config = await readSsoConfig({
      CODEX_WEB_AUTH_MODE: "sso",
      CODEX_WEB_OIDC_PROVIDER_NAME: "Custom IdP",
      CODEX_WEB_OIDC_ISSUER: "https://auth.example.org/",
      CODEX_WEB_OIDC_CLIENT_ID: "env-client",
      CODEX_WEB_OIDC_CLIENT_SECRET: "env-secret",
      CODEX_WEB_OIDC_ALLOWED_EMAILS: "user@example.org",
    });
    expect(config).toEqual({
      enabled: true,
      providerName: "Custom IdP",
      issuer: "https://auth.example.org",
      clientId: "env-client",
      clientSecret: "env-secret",
      scopes: "openid email profile",
      allowedEmails: ["user@example.org"],
      allowedDomains: [],
    });
  });

  it("checks email allowlists and domain allowlists accurately", () => {
    expect(isEmailAllowedBySsoConfig("ADMIN@example.test", SAMPLE_SSO)).toBe(true);
    expect(isEmailAllowedBySsoConfig("someone@corp.example.test", SAMPLE_SSO)).toBe(true);
    expect(isEmailAllowedBySsoConfig("stranger@other.test", SAMPLE_SSO)).toBe(false);

    const unrestricted: SsoConfig = { ...SAMPLE_SSO, allowedEmails: [], allowedDomains: [] };
    expect(isEmailAllowedBySsoConfig("anyone@anywhere.test", unrestricted)).toBe(true);
  });

  it("allows startup in SSO mode without CODEX_WEB_LOGIN_EMAIL or CODEX_WEB_LOGIN_PASSWORD", () => {
    const ssoEnv = {
      CODEX_WEB_AUTH_MODE: "sso",
      CODEX_WEB_OIDC_ISSUER: SAMPLE_SSO.issuer,
      CODEX_WEB_OIDC_CLIENT_ID: SAMPLE_SSO.clientId,
      CODEX_WEB_OIDC_CLIENT_SECRET: SAMPLE_SSO.clientSecret,
      CODEX_WEB_SESSION_SECRET: SESSION_SECRET,
    };
    expect(() => assertWebAuthStartupConfig(ssoEnv)).not.toThrow();
  });

  it("issues and verifies SSO session tokens and invalidates them when SSO config changes", async () => {
    const now = 1_800_000_000_000;
    const token = createSsoSessionToken("admin@example.test", SAMPLE_SSO, SESSION_SECRET, now);
    expect(verifySsoSessionToken(token, SAMPLE_SSO, SESSION_SECRET, now + 1_000)?.email).toBe(
      "admin@example.test",
    );

    const rotatedSecretConfig = { ...SAMPLE_SSO, clientSecret: "rotated-secret" };
    expect(verifySsoSessionToken(token, rotatedSecretConfig, SESSION_SECRET, now + 1_000)).toBeNull();

    const ssoEnv = {
      CODEX_WEB_AUTH_MODE: "sso",
      CODEX_WEB_OIDC_ISSUER: SAMPLE_SSO.issuer,
      CODEX_WEB_OIDC_CLIENT_ID: SAMPLE_SSO.clientId,
      CODEX_WEB_OIDC_CLIENT_SECRET: SAMPLE_SSO.clientSecret,
      CODEX_WEB_OIDC_ALLOWED_EMAILS: "admin@example.test",
      CODEX_WEB_SESSION_SECRET: SESSION_SECRET,
    };
    const request = new Request("http://localhost:3001/chat", {
      headers: { cookie: `${WEB_AUTH_COOKIE}=${token}` },
    });
    const user = await authenticateWebRequest(request, ssoEnv);
    expect(user?.email).toBe("admin@example.test");
  });

  it("completes OIDC discovery, PKCE authorization URL, code exchange, and RS256 JWKS id_token verification", async () => {
    const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const publicJwk = {
      ...(publicKey.export({ format: "jwk" }) as Record<string, unknown>),
      kid: "key-1",
      alg: "RS256",
      use: "sig",
      kty: "RSA",
    };

    const discoveryDoc: OidcDiscoveryDocument = {
      issuer: SAMPLE_SSO.issuer,
      authorization_endpoint: `${SAMPLE_SSO.issuer}/authorize`,
      token_endpoint: `${SAMPLE_SSO.issuer}/token`,
      jwks_uri: `${SAMPLE_SSO.issuer}/jwks`,
    };

    const pkce = generatePkcePair();
    const stateToken = createOidcStateToken(
      {
        state: "state-abc",
        nonce: "nonce-xyz",
        codeVerifier: pkce.codeVerifier,
        redirectUri: "http://127.0.0.1:3001/api/auth/sso/callback",
        next: "/chat",
      },
      SESSION_SECRET,
      1_800_000_000_000,
    );
    const verifiedState = verifyOidcStateToken(stateToken, SESSION_SECRET, 1_800_000_001_000);
    expect(verifiedState?.state).toBe("state-abc");

    const authUrl = new URL(
      buildOidcAuthorizationUrl({
        discovery: discoveryDoc,
        clientId: SAMPLE_SSO.clientId,
        redirectUri: "http://127.0.0.1:3001/api/auth/sso/callback",
        scopes: SAMPLE_SSO.scopes,
        state: "state-abc",
        nonce: "nonce-xyz",
        codeChallenge: pkce.codeChallenge,
      }),
    );
    expect(authUrl.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authUrl.searchParams.get("client_id")).toBe(SAMPLE_SSO.clientId);

    const nowMs = 1_800_000_000_000;
    const nowSec = Math.floor(nowMs / 1_000);
    const headerB64 = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT", kid: "key-1" })).toString("base64url");
    const payloadB64 = Buffer.from(
      JSON.stringify({
        iss: SAMPLE_SSO.issuer,
        sub: "user-sub-1",
        aud: [SAMPLE_SSO.clientId],
        exp: nowSec + 300,
        iat: nowSec,
        nonce: "nonce-xyz",
        email: "admin@example.test",
      }),
    ).toString("base64url");
    const signer = createSign("RSA-SHA256");
    signer.update(`${headerB64}.${payloadB64}`);
    const signatureB64 = signer.sign(privateKey).toString("base64url");
    const signedIdToken = `${headerB64}.${payloadB64}.${signatureB64}`;

    const mockFetch: typeof fetch = async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.endsWith("/.well-known/openid-configuration")) {
        return new Response(JSON.stringify(discoveryDoc), { status: 200 });
      }
      if (url === discoveryDoc.token_endpoint) {
        return new Response(JSON.stringify({ id_token: signedIdToken, access_token: "at-1" }), {
          status: 200,
        });
      }
      if (url === discoveryDoc.jwks_uri) {
        return new Response(JSON.stringify({ keys: [publicJwk] }), { status: 200 });
      }
      return new Response("not found", { status: 404 });
    };

    const fetchedDiscovery = await fetchOidcDiscovery(SAMPLE_SSO.issuer, mockFetch);
    expect(fetchedDiscovery.token_endpoint).toBe(discoveryDoc.token_endpoint);

    const tokenSet = await exchangeOidcAuthorizationCode(
      {
        discovery: fetchedDiscovery,
        clientId: SAMPLE_SSO.clientId,
        clientSecret: SAMPLE_SSO.clientSecret,
        code: "auth-code-1",
        redirectUri: "http://127.0.0.1:3001/api/auth/sso/callback",
        codeVerifier: pkce.codeVerifier,
      },
      mockFetch,
    );
    expect(tokenSet.idToken).toBe(signedIdToken);

    const identity = await verifyOidcIdTokenAndExtractIdentity(
      {
        idToken: tokenSet.idToken,
        discovery: fetchedDiscovery,
        clientId: SAMPLE_SSO.clientId,
        expectedNonce: "nonce-xyz",
        now: nowMs,
      },
      mockFetch,
    );
    expect(identity).toEqual({
      sub: "user-sub-1",
      email: "admin@example.test",
    });
  });
});
