import { NextRequest, NextResponse } from "next/server";

import { resolveLoginDestination } from "@/lib/web-login";
import { withNoStore } from "../../../../../../server/http-cache";
import {
  buildOidcAuthorizationUrl,
  createOidcStateToken,
  fetchOidcDiscovery,
  generatePkcePair,
  generateRandomOidcValue,
  resolveRequestOrigin,
  WEB_OIDC_STATE_COOKIE,
  WEB_OIDC_STATE_MAX_AGE_SECONDS,
} from "../../../../../../server/oidc";
import { readSsoConfig } from "../../../../../../server/sso-config";
import { readSessionSecret } from "../../../../../../server/web-auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const origin = resolveRequestOrigin(request);
  const next = resolveLoginDestination(request.nextUrl.searchParams.get("next"));

  try {
    const sso = await readSsoConfig();
    if (!sso.enabled) {
      const loginUrl = new URL("/login", origin);
      loginUrl.searchParams.set("next", next);
      loginUrl.searchParams.set("error", "SSO authentication is not enabled");
      return withNoStore(NextResponse.redirect(loginUrl));
    }

    const sessionSecret = readSessionSecret(process.env);
    const discovery = await fetchOidcDiscovery(sso.issuer);
    const { codeVerifier, codeChallenge } = generatePkcePair();
    const state = generateRandomOidcValue(24);
    const nonce = generateRandomOidcValue(24);
    const redirectUri = `${origin}/api/auth/sso/callback`;

    const stateToken = createOidcStateToken(
      {
        state,
        nonce,
        codeVerifier,
        redirectUri,
        next,
      },
      sessionSecret,
    );

    const authorizationUrl = buildOidcAuthorizationUrl({
      discovery,
      clientId: sso.clientId,
      redirectUri,
      scopes: sso.scopes,
      state,
      nonce,
      codeChallenge,
    });

    const response = withNoStore(NextResponse.redirect(authorizationUrl));
    response.cookies.set(WEB_OIDC_STATE_COOKIE, stateToken, {
      httpOnly: true,
      sameSite: "lax",
      secure: origin.startsWith("https://"),
      path: "/",
      maxAge: WEB_OIDC_STATE_MAX_AGE_SECONDS,
    });
    return response;
  } catch (error) {
    const loginUrl = new URL("/login", origin);
    loginUrl.searchParams.set("next", next);
    loginUrl.searchParams.set(
      "error",
      error instanceof Error ? error.message : "Failed to initiate SSO login",
    );
    return withNoStore(NextResponse.redirect(loginUrl));
  }
}
