import { NextRequest, NextResponse } from "next/server";

import {
  authenticateWebRequest,
  isSameOriginRequest,
  readSessionCookie,
  runtimeBrokerSocket,
} from "../../../../../server/web-auth";
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
  const brokerTurnstile = brokerSocket
    ? await new RuntimeBrokerClient(brokerSocket).readTurnstilePublic()
    : null;
  const rootManaged = brokerTurnstile?.rootManaged === true;
  const turnstile = rootManaged
    ? brokerTurnstile.config
    : publicTurnstileConfig(await readTurnstileConfig());
  return NextResponse.json(
    { email: user.email, canManageSecurity: rootManaged ? user.osUser === "root" : user.role === "admin", rootManaged, turnstile },
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
    const brokerSocket = runtimeBrokerSocket();
    const brokerClient = brokerSocket ? new RuntimeBrokerClient(brokerSocket) : null;
    const brokerTurnstile = brokerClient ? await brokerClient.readTurnstilePublic() : null;
    const rootManaged = brokerTurnstile?.rootManaged === true;
    if (rootManaged && user.osUser !== "root") {
      return NextResponse.json({ error: "只有 root 账号可以管理 Turnstile" }, { status: 403 });
    }
    if (!rootManaged && user.role !== "admin") {
      return NextResponse.json({ error: "需要管理员权限" }, { status: 403 });
    }
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
    return NextResponse.json({
      email: user.email,
      canManageSecurity: true,
      rootManaged,
      turnstile: saved,
    });
  } catch (error) {
    const status = error instanceof BrokerClientError && error.code === "forbidden" ? 403 : 400;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "保存 Turnstile 配置失败" },
      { status },
    );
  }
}

function unauthorized() {
  return NextResponse.json({ error: "登录已失效" }, { status: 401 });
}
