import { NextRequest, NextResponse } from "next/server";

import {
  authenticateWebRequest,
  createSessionToken,
  createSsoSessionToken,
  isSameOriginRequest,
  readSessionCookie,
  readSessionSecret,
  readWebAuthConfig,
  runtimeBrokerSocket,
  WEB_AUTH_COOKIE,
  WEB_AUTH_MAX_AGE_SECONDS,
} from "../../../../../server/web-auth";
import {
  mergeSsoConfig,
  publicSsoConfig,
  readSsoConfig,
  writeSsoConfig,
  type SsoConfigUpdate,
} from "../../../../../server/sso-config";
import {
  mergeTurnstileConfig,
  publicTurnstileConfig,
  readTurnstileConfig,
  writeTurnstileConfig,
} from "../../../../../server/turnstile-config";
import { BrokerClientError, RuntimeBrokerClient } from "../../../../../server/runtime-broker-client";
import { verifyTurnstileTokenDetailed } from "../../../../../server/turnstile";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const user = await authenticateWebRequest(request);
  if (!user) return unauthorized();
  const brokerSocket = runtimeBrokerSocket();
  const [brokerTurnstile, ssoConfig] = await Promise.all([
    brokerSocket ? new RuntimeBrokerClient(brokerSocket).readTurnstilePublic() : Promise.resolve(null),
    readSsoConfig(),
  ]);
  const rootManaged = brokerTurnstile?.rootManaged === true;
  const turnstile = rootManaged
    ? brokerTurnstile.config
    : publicTurnstileConfig(await readTurnstileConfig());
  return NextResponse.json(
    {
      email: user.email,
      canManageSecurity: rootManaged ? user.osUser === "root" : user.role === "admin",
      rootManaged,
      turnstile,
      sso: publicSsoConfig(ssoConfig),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function PATCH(request: NextRequest) {
  const user = await authenticateWebRequest(request);
  if (!user) return unauthorized();
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: "请求来源无效" }, { status: 403 });
  }
  try {
    const body = await request.json() as Record<string, unknown>;
    const brokerSocket = runtimeBrokerSocket();
    const brokerClient = brokerSocket ? new RuntimeBrokerClient(brokerSocket) : null;
    const brokerTurnstile = brokerClient ? await brokerClient.readTurnstilePublic() : null;
    const rootManaged = brokerTurnstile?.rootManaged === true;
    if (rootManaged && user.osUser !== "root") {
      return NextResponse.json({ error: "只有 root 账号可以管理安全设置" }, { status: 403 });
    }
    if (!rootManaged && user.role !== "admin") {
      return NextResponse.json({ error: "需要管理员权限" }, { status: 403 });
    }

    if (body.sso && typeof body.sso === "object") {
      const rawSso = body.sso as Record<string, unknown>;
      if (
        typeof rawSso.enabled !== "boolean"
        || typeof rawSso.issuer !== "string"
        || typeof rawSso.clientId !== "string"
      ) {
        return NextResponse.json({ error: "Invalid SSO configuration format" }, { status: 400 });
      }
      const ssoUpdate: SsoConfigUpdate = {
        enabled: rawSso.enabled,
        providerName: typeof rawSso.providerName === "string" ? rawSso.providerName : undefined,
        issuer: rawSso.issuer,
        clientId: rawSso.clientId,
        clientSecret: typeof rawSso.clientSecret === "string" ? rawSso.clientSecret : undefined,
        scopes: typeof rawSso.scopes === "string" ? rawSso.scopes : undefined,
        allowedEmails: Array.isArray(rawSso.allowedEmails) || typeof rawSso.allowedEmails === "string"
          ? (rawSso.allowedEmails as string[] | string)
          : undefined,
        allowedDomains: Array.isArray(rawSso.allowedDomains) || typeof rawSso.allowedDomains === "string"
          ? (rawSso.allowedDomains as string[] | string)
          : undefined,
      };
      const currentSso = await readSsoConfig();
      mergeSsoConfig(currentSso, ssoUpdate);
      const savedSso = await writeSsoConfig(ssoUpdate);
      const turnstile = rootManaged
        ? brokerTurnstile!.config
        : publicTurnstileConfig(await readTurnstileConfig());

      const response = NextResponse.json({
        email: user.email,
        canManageSecurity: true,
        rootManaged,
        turnstile,
        sso: publicSsoConfig(savedSso),
      });

      if (!brokerSocket) {
        try {
          const sessionSecret = readSessionSecret(process.env);
          if (savedSso.enabled) {
            const sessionEmail = savedSso.allowedEmails[0] || user.email;
            const newToken = createSsoSessionToken(sessionEmail, savedSso, sessionSecret);
            response.cookies.set(WEB_AUTH_COOKIE, newToken, {
              httpOnly: true,
              sameSite: "lax",
              secure: request.nextUrl.protocol === "https:",
              path: "/",
              maxAge: WEB_AUTH_MAX_AGE_SECONDS,
            });
          } else if (process.env.CODEX_WEB_LOGIN_EMAIL && process.env.CODEX_WEB_LOGIN_PASSWORD) {
            const localAuth = readWebAuthConfig(process.env);
            const newToken = createSessionToken(localAuth);
            response.cookies.set(WEB_AUTH_COOKIE, newToken, {
              httpOnly: true,
              sameSite: "lax",
              secure: request.nextUrl.protocol === "https:",
              path: "/",
              maxAge: WEB_AUTH_MAX_AGE_SECONDS,
            });
          }
        } catch {
          // Keep existing cookie if fallback credentials are not configured in env
        }
      }
      return response;
    }

    if (typeof body.enabled !== "boolean" || typeof body.siteKey !== "string") {
      return NextResponse.json({ error: "Turnstile 配置格式无效" }, { status: 400 });
    }
    if (body.secretKey !== undefined && typeof body.secretKey !== "string") {
      return NextResponse.json({ error: "Turnstile 私密密钥格式无效" }, { status: 400 });
    }
    if (body.enabled === true && typeof body.turnstileToken !== "string") {
      return NextResponse.json({ error: "Turnstile 预检 token 格式无效" }, { status: 400 });
    }
    const turnstileToken = typeof body.turnstileToken === "string" ? body.turnstileToken : "";
    const update = {
      enabled: body.enabled,
      siteKey: body.siteKey,
      secretKey: body.secretKey as string | undefined,
    };
    let saved;
    if (rootManaged) {
      const sessionToken = readSessionCookie(request.headers.get("cookie"));
      if (!sessionToken) return unauthorized();
      saved = await brokerClient!.updateTurnstile(sessionToken, update, turnstileToken);
    } else {
      const current = await readTurnstileConfig();
      const candidate = mergeTurnstileConfig(current, update);
      if (candidate.enabled) {
        const verification = await verifyTurnstileTokenDetailed(turnstileToken, candidate.secretKey);
        if (!verification.success) {
          const codes = verification.errorCodes?.join(",") ?? "none";
          return NextResponse.json(
            { error: `Turnstile 配置验证失败：reason=${verification.reason} codes=${codes}` },
            { status: 400 },
          );
        }
      }
      saved = publicTurnstileConfig(await writeTurnstileConfig(update));
    }
    const ssoConfig = await readSsoConfig();
    return NextResponse.json({
      email: user.email,
      canManageSecurity: true,
      rootManaged,
      turnstile: saved,
      sso: publicSsoConfig(ssoConfig),
    });
  } catch (error) {
    const status = error instanceof BrokerClientError && error.code === "forbidden" ? 403 : 400;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "保存安全配置失败" },
      { status },
    );
  }
}

function unauthorized() {
  return NextResponse.json({ error: "登录已失效" }, { status: 401 });
}
