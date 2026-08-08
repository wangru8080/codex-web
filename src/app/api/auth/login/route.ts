import { NextRequest, NextResponse } from "next/server";

import {
  createSessionToken,
  isSameOriginRequest,
  readWebAuthConfig,
  runtimeBrokerSocket,
  verifyCredentials,
  WEB_AUTH_COOKIE,
  WEB_AUTH_MAX_AGE_SECONDS,
} from "../../../../../server/web-auth";
import { BrokerClientError, RuntimeBrokerClient } from "../../../../../server/runtime-broker-client";
import { readTurnstileConfig } from "../../../../../server/turnstile-config";
import { verifyTurnstileTokenDetailed } from "../../../../../server/turnstile";

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: "请求来源无效" }, { status: 403 });
  }

  let body: { email?: unknown; password?: unknown; turnstileToken?: unknown };
  try {
    body = await request.json();
  } catch {
    return invalidLogin();
  }
  const email = typeof body.email === "string" ? body.email : "";
  const password = typeof body.password === "string" ? body.password : "";
  const token = typeof body.turnstileToken === "string" ? body.turnstileToken : "";

  const brokerSocket = runtimeBrokerSocket();
  const brokerClient = brokerSocket ? new RuntimeBrokerClient(brokerSocket) : null;
  const brokerTurnstile = brokerClient ? await brokerClient.readTurnstilePublic() : null;
  const localTurnstile = brokerTurnstile?.rootManaged ? null : await readTurnstileConfig();
  const turnstileEnabled = brokerTurnstile?.rootManaged
    ? brokerTurnstile.config.enabled
    : localTurnstile?.enabled === true;
  if (turnstileEnabled) {
    const remoteIp = request.headers.get("x-real-ip") ?? undefined;
    const verification = brokerTurnstile?.rootManaged
      ? await brokerClient!.verifyTurnstile(token, remoteIp)
      : await verifyTurnstileTokenDetailed(token, localTurnstile!.secretKey, remoteIp);
    if (!verification.success) {
      const codes = verification.errorCodes?.join(",") ?? "none";
      console.warn(`[auth/login] Turnstile 验证失败：reason=${verification.reason} codes=${codes}`);
      return NextResponse.json({ error: "人机验证未通过", code: "turnstile_failed" }, { status: 400 });
    }
  }

  let sessionToken: string;
  if (brokerSocket) {
    try {
      const login = await new RuntimeBrokerClient(brokerSocket).login(
        email,
        password,
        request.headers.get("x-real-ip") ?? undefined,
      );
      sessionToken = login.token;
    } catch (error) {
      if (error instanceof BrokerClientError && error.code === "rate_limited") {
        return NextResponse.json({ error: error.message }, { status: 429 });
      }
      return invalidLogin();
    }
  } else {
    const auth = readWebAuthConfig(process.env);
    if (!verifyCredentials(email, password, auth)) return invalidLogin();
    sessionToken = createSessionToken(auth);
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(WEB_AUTH_COOKIE, sessionToken, {
    httpOnly: true,
    sameSite: "strict",
    secure: request.nextUrl.protocol === "https:",
    path: "/",
    maxAge: WEB_AUTH_MAX_AGE_SECONDS,
  });
  return response;
}

function invalidLogin() {
  return NextResponse.json({ error: "邮箱或密码错误" }, { status: 401 });
}
