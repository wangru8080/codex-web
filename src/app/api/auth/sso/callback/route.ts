import { NextRequest, NextResponse } from "next/server";

import { resolveLoginDestination } from "@/lib/web-login";
import { withNoStore } from "../../../../../../server/http-cache";
import {
  exchangeOidcAuthorizationCode,
  fetchOidcDiscovery,
  readCookieByName,
  resolveRequestOrigin,
  verifyOidcIdTokenAndExtractIdentity,
  verifyOidcStateToken,
  WEB_OIDC_STATE_COOKIE,
} from "../../../../../../server/oidc";
import { RuntimeBrokerClient } from "../../../../../../server/runtime-broker-client";
import { isEmailAllowedBySsoConfig, readSsoConfig } from "../../../../../../server/sso-config";
import {
  createSsoSessionToken,
  readSessionSecret,
  runtimeBrokerSocket,
  WEB_AUTH_COOKIE,
  WEB_AUTH_MAX_AGE_SECONDS,
} from "../../../../../../server/web-auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const origin = resolveRequestOrigin(request);
  const providerError =
    request.nextUrl.searchParams.get("error_description") ||
    request.nextUrl.searchParams.get("error");
  if (providerError) {
    return redirectWithError(origin, "/chat", `SSO provider error: ${providerError}`);
  }

  const code = request.nextUrl.searchParams.get("code")?.trim() || "";
  const state = request.nextUrl.searchParams.get("state")?.trim() || "";
  if (!code || !state) {
    return redirectWithError(origin, "/chat", "Missing authorization code or state from SSO provider");
  }

  let next = "/chat";
  try {
    const sso = await readSsoConfig();
    if (!sso.enabled) {
      return redirectWithError(origin, next, "SSO authentication is not enabled");
    }

    const sessionSecret = readSessionSecret(process.env);
    const rawStateCookie = readCookieByName(request.headers.get("cookie"), WEB_OIDC_STATE_COOKIE);
    const statePayload = verifyOidcStateToken(rawStateCookie, sessionSecret);
    if (!statePayload || statePayload.state !== state) {
      return redirectWithError(origin, next, "Invalid or expired SSO state; please try signing in again");
    }
    next = resolveLoginDestination(statePayload.next);

    const discovery = await fetchOidcDiscovery(sso.issuer);
    const tokenSet = await exchangeOidcAuthorizationCode({
      discovery,
      clientId: sso.clientId,
      clientSecret: sso.clientSecret,
      code,
      redirectUri: statePayload.redirectUri,
      codeVerifier: statePayload.codeVerifier,
    });

    const identity = await verifyOidcIdTokenAndExtractIdentity({
      idToken: tokenSet.idToken,
      accessToken: tokenSet.accessToken,
      discovery,
      clientId: sso.clientId,
      expectedNonce: statePayload.nonce,
    });

    if (!isEmailAllowedBySsoConfig(identity.email, sso)) {
      return redirectWithError(
        origin,
        next,
        `Account ${identity.email} is not authorized to access this instance`,
      );
    }

    const brokerSocket = runtimeBrokerSocket();
    let sessionToken: string;
    if (brokerSocket) {
      const login = await new RuntimeBrokerClient(brokerSocket).ssoLogin(identity.email);
      sessionToken = login.token;
    } else {
      sessionToken = createSsoSessionToken(identity.email, sso, sessionSecret);
    }

    const destinationUrl = new URL(next, origin);
    const response = withNoStore(NextResponse.redirect(destinationUrl));
    response.cookies.set(WEB_AUTH_COOKIE, sessionToken, {
      httpOnly: true,
      sameSite: "lax",
      secure: origin.startsWith("https://"),
      path: "/",
      maxAge: WEB_AUTH_MAX_AGE_SECONDS,
    });
    response.cookies.set(WEB_OIDC_STATE_COOKIE, "", {
      httpOnly: true,
      sameSite: "lax",
      secure: origin.startsWith("https://"),
      path: "/",
      maxAge: 0,
    });
    return response;
  } catch (error) {
    return redirectWithError(
      origin,
      next,
      error instanceof Error ? error.message : "SSO login verification failed",
    );
  }
}

function redirectWithError(origin: string, next: string, errorMessage: string): NextResponse {
  const loginUrl = new URL("/login", origin);
  loginUrl.searchParams.set("next", resolveLoginDestination(next));
  loginUrl.searchParams.set("error", errorMessage);
  const response = withNoStore(NextResponse.redirect(loginUrl));
  response.cookies.set(WEB_OIDC_STATE_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: origin.startsWith("https://"),
    path: "/",
    maxAge: 0,
  });
  return response;
}
