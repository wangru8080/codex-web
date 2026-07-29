import { NextRequest, NextResponse } from "next/server";

import {
  authenticateWebRequest,
  isSameOriginRequest,
} from "../../../../../server/web-auth";
import {
  publicTurnstileConfig,
  readTurnstileConfig,
  writeTurnstileConfig,
} from "../../../../../server/turnstile-config";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const user = await authenticateWebRequest(request);
  if (!user) return unauthorized();
  const turnstile = publicTurnstileConfig(await readTurnstileConfig());
  return NextResponse.json(
    { email: user.email, canManageSecurity: user.role === "admin", turnstile },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function PATCH(request: NextRequest) {
  const user = await authenticateWebRequest(request);
  if (!user) return unauthorized();
  if (user.role !== "admin") return NextResponse.json({ error: "需要管理员权限" }, { status: 403 });
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
    const saved = await writeTurnstileConfig({
      enabled: body.enabled,
      siteKey: body.siteKey,
      secretKey: body.secretKey as string | undefined,
    });
    return NextResponse.json({
      email: user.email,
      canManageSecurity: true,
      turnstile: publicTurnstileConfig(saved),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "保存 Turnstile 配置失败" },
      { status: 400 },
    );
  }
}

function unauthorized() {
  return NextResponse.json({ error: "登录已失效" }, { status: 401 });
}
