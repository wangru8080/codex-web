import {
  createHash,
  createHmac,
  createPublicKey,
  randomBytes,
  timingSafeEqual,
  verify as cryptoVerify,
  type JsonWebKey,
} from "node:crypto";

import { DEFAULT_OIDC_SCOPES, normalizeIssuerUrl } from "./sso-config";

export const WEB_OIDC_STATE_COOKIE = "codex_web_oidc_state";
export const WEB_OIDC_STATE_MAX_AGE_SECONDS = 10 * 60;

export type OidcDiscoveryDocument = {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  userinfo_endpoint?: string;
};

export type OidcStatePayload = {
  state: string;
  nonce: string;
  codeVerifier: string;
  redirectUri: string;
  next: string;
  expiresAt: number;
};

export type OidcVerifiedIdentity = {
  sub: string;
  email: string;
  name?: string;
};

type JwkKey = JsonWebKey & {
  kid?: string;
  use?: string;
  alg?: string;
  kty: string;
};

export function generatePkcePair(): { codeVerifier: string; codeChallenge: string } {
  const codeVerifier = randomBytes(32).toString("base64url");
  const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
  return { codeVerifier, codeChallenge };
}

export function generateRandomOidcValue(bytes = 24): string {
  return randomBytes(bytes).toString("base64url");
}

export function createOidcStateToken(
  payload: Omit<OidcStatePayload, "expiresAt">,
  sessionSecret: string,
  now = Date.now(),
): string {
  const fullPayload: OidcStatePayload = {
    ...payload,
    expiresAt: now + WEB_OIDC_STATE_MAX_AGE_SECONDS * 1_000,
  };
  const encoded = Buffer.from(JSON.stringify(fullPayload)).toString("base64url");
  const signature = signHmac(encoded, sessionSecret);
  return `${encoded}.${signature}`;
}

export function verifyOidcStateToken(
  token: string | undefined,
  sessionSecret: string,
  now = Date.now(),
): OidcStatePayload | null {
  if (!token) return null;
  const separator = token.lastIndexOf(".");
  if (separator <= 0) return null;
  const encoded = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  if (!constantTimeEqual(signature, signHmac(encoded, sessionSecret))) return null;
  try {
    const parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as Partial<OidcStatePayload>;
    if (
      typeof parsed.state !== "string" ||
      !parsed.state ||
      typeof parsed.nonce !== "string" ||
      !parsed.nonce ||
      typeof parsed.codeVerifier !== "string" ||
      !parsed.codeVerifier ||
      typeof parsed.redirectUri !== "string" ||
      !parsed.redirectUri ||
      typeof parsed.next !== "string" ||
      typeof parsed.expiresAt !== "number" ||
      parsed.expiresAt <= now
    ) {
      return null;
    }
    return parsed as OidcStatePayload;
  } catch {
    return null;
  }
}

export function readCookieByName(cookieHeader: string | null, cookieName: string): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name === cookieName) {
      try {
        return decodeURIComponent(value.join("="));
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

export async function fetchOidcDiscovery(
  issuer: string,
  fetchImpl: typeof fetch = fetch,
): Promise<OidcDiscoveryDocument> {
  const normalized = normalizeIssuerUrl(issuer);
  if (!normalized) {
    throw new Error("OIDC Issuer URL is not configured");
  }
  const discoveryUrl = `${normalized}/.well-known/openid-configuration`;
  const response = await fetchImpl(discoveryUrl, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch OIDC discovery document (${response.status})`);
  }
  const doc = (await response.json()) as Partial<OidcDiscoveryDocument>;
  if (
    typeof doc.issuer !== "string" ||
    typeof doc.authorization_endpoint !== "string" ||
    typeof doc.token_endpoint !== "string" ||
    typeof doc.jwks_uri !== "string"
  ) {
    throw new Error("Invalid OIDC discovery document: missing required endpoints");
  }
  return {
    issuer: doc.issuer,
    authorization_endpoint: doc.authorization_endpoint,
    token_endpoint: doc.token_endpoint,
    jwks_uri: doc.jwks_uri,
    ...(typeof doc.userinfo_endpoint === "string" ? { userinfo_endpoint: doc.userinfo_endpoint } : {}),
  };
}

export function buildOidcAuthorizationUrl(params: {
  discovery: OidcDiscoveryDocument;
  clientId: string;
  redirectUri: string;
  scopes?: string;
  state: string;
  nonce: string;
  codeChallenge: string;
}): string {
  const url = new URL(params.discovery.authorization_endpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", params.clientId);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("scope", params.scopes?.trim() || DEFAULT_OIDC_SCOPES);
  url.searchParams.set("state", params.state);
  url.searchParams.set("nonce", params.nonce);
  url.searchParams.set("code_challenge", params.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

export async function exchangeOidcAuthorizationCode(
  params: {
    discovery: OidcDiscoveryDocument;
    clientId: string;
    clientSecret: string;
    code: string;
    redirectUri: string;
    codeVerifier: string;
  },
  fetchImpl: typeof fetch = fetch,
): Promise<{ idToken: string; accessToken?: string }> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: params.code,
    redirect_uri: params.redirectUri,
    client_id: params.clientId,
    client_secret: params.clientSecret,
    code_verifier: params.codeVerifier,
  });

  const response = await fetchImpl(params.discovery.token_endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: body.toString(),
    cache: "no-store",
  });

  const payload = (await response.json().catch(() => null)) as
    | { id_token?: string; access_token?: string; error?: string; error_description?: string }
    | null;

  if (!response.ok || !payload?.id_token) {
    const detail = payload?.error_description || payload?.error || `HTTP ${response.status}`;
    throw new Error(`OIDC token exchange failed: ${detail}`);
  }

  return {
    idToken: payload.id_token,
    ...(typeof payload.access_token === "string" ? { accessToken: payload.access_token } : {}),
  };
}

export async function verifyOidcIdTokenAndExtractIdentity(
  params: {
    idToken: string;
    accessToken?: string;
    discovery: OidcDiscoveryDocument;
    clientId: string;
    expectedNonce: string;
    now?: number;
  },
  fetchImpl: typeof fetch = fetch,
): Promise<OidcVerifiedIdentity> {
  const parts = params.idToken.split(".");
  if (parts.length !== 3) {
    throw new Error("Invalid OIDC id_token format");
  }
  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const header = JSON.parse(Buffer.from(encodedHeader, "base64url").toString("utf8")) as {
    alg?: string;
    kid?: string;
    typ?: string;
  };
  const claims = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as {
    iss?: string;
    sub?: string;
    aud?: string | string[];
    exp?: number;
    nbf?: number;
    nonce?: string;
    email?: string;
    name?: string;
  };

  const jwksResponse = await fetchImpl(params.discovery.jwks_uri, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (!jwksResponse.ok) {
    throw new Error(`Failed to fetch OIDC JWKS (${jwksResponse.status})`);
  }
  const jwks = (await jwksResponse.json()) as { keys?: JwkKey[] };
  const keys = Array.isArray(jwks.keys) ? jwks.keys : [];
  if (keys.length === 0) {
    throw new Error("OIDC JWKS endpoint returned no keys");
  }

  const candidateKeys = header.kid
    ? keys.filter((key) => key.kid === header.kid)
    : keys.filter((key) => !key.use || key.use === "sig");
  if (candidateKeys.length === 0) {
    throw new Error("No matching JWK found for id_token kid");
  }

  const signingInput = Buffer.from(`${encodedHeader}.${encodedPayload}`, "utf8");
  const signatureBytes = Buffer.from(encodedSignature, "base64url");
  const verified = candidateKeys.some((jwk) =>
    verifyJwsSignature(header.alg ?? "RS256", signingInput, signatureBytes, jwk),
  );
  if (!verified) {
    throw new Error("OIDC id_token signature verification failed");
  }

  const expectedIssuer = normalizeIssuerUrl(params.discovery.issuer);
  const actualIssuer = typeof claims.iss === "string" ? normalizeIssuerUrl(claims.iss) : "";
  if (!actualIssuer || actualIssuer !== expectedIssuer) {
    throw new Error("OIDC id_token issuer mismatch");
  }

  const audiences = Array.isArray(claims.aud)
    ? claims.aud
    : typeof claims.aud === "string"
      ? [claims.aud]
      : [];
  if (!audiences.includes(params.clientId)) {
    throw new Error("OIDC id_token audience mismatch");
  }

  const nowSeconds = Math.floor((params.now ?? Date.now()) / 1_000);
  if (typeof claims.exp !== "number" || claims.exp <= nowSeconds - 30) {
    throw new Error("OIDC id_token has expired");
  }
  if (typeof claims.nbf === "number" && claims.nbf > nowSeconds + 30) {
    throw new Error("OIDC id_token is not yet valid");
  }
  if (claims.nonce !== undefined && claims.nonce !== params.expectedNonce) {
    throw new Error("OIDC id_token nonce mismatch");
  }
  if (typeof claims.sub !== "string" || !claims.sub.trim()) {
    throw new Error("OIDC id_token is missing subject (sub) claim");
  }

  let email = typeof claims.email === "string" ? claims.email.trim().toLowerCase() : "";
  let name = typeof claims.name === "string" ? claims.name.trim() : undefined;

  if (!email && params.accessToken && params.discovery.userinfo_endpoint) {
    const userInfoResponse = await fetchImpl(params.discovery.userinfo_endpoint, {
      headers: {
        Authorization: `Bearer ${params.accessToken}`,
        Accept: "application/json",
      },
      cache: "no-store",
    });
    if (userInfoResponse.ok) {
      const userInfo = (await userInfoResponse.json().catch(() => null)) as
        | { email?: string; name?: string }
        | null;
      if (typeof userInfo?.email === "string") {
        email = userInfo.email.trim().toLowerCase();
      }
      if (!name && typeof userInfo?.name === "string") {
        name = userInfo.name.trim();
      }
    }
  }

  if (!email) {
    throw new Error("OIDC provider did not return an email claim");
  }

  return {
    sub: claims.sub,
    email,
    ...(name ? { name } : {}),
  };
}

export function resolveRequestOrigin(request: Request): string {
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwardedHost || request.headers.get("host");
  const requestUrl = new URL(request.url);
  const protocol = forwardedProto ? `${forwardedProto.replace(/:$/, "")}:` : requestUrl.protocol;
  const effectiveHost = host || requestUrl.host;
  return `${protocol}//${effectiveHost}`;
}

function verifyJwsSignature(
  alg: string,
  signingInput: Buffer,
  signature: Buffer,
  jwk: JwkKey,
): boolean {
  try {
    const publicKey = createPublicKey({ key: jwk, format: "jwk" });
    switch (alg) {
      case "RS256":
        return cryptoVerify("RSA-SHA256", signingInput, publicKey, signature);
      case "RS384":
        return cryptoVerify("RSA-SHA384", signingInput, publicKey, signature);
      case "RS512":
        return cryptoVerify("RSA-SHA512", signingInput, publicKey, signature);
      case "ES256":
        return cryptoVerify(
          "sha256",
          signingInput,
          { key: publicKey, dsaEncoding: "ieee-p1363" },
          signature,
        );
      case "ES384":
        return cryptoVerify(
          "sha384",
          signingInput,
          { key: publicKey, dsaEncoding: "ieee-p1363" },
          signature,
        );
      case "ES512":
        return cryptoVerify(
          "sha512",
          signingInput,
          { key: publicKey, dsaEncoding: "ieee-p1363" },
          signature,
        );
      default:
        return false;
    }
  } catch {
    return false;
  }
}

function signHmac(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftHash = createHash("sha256").update(left).digest();
  const rightHash = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftHash, rightHash);
}
