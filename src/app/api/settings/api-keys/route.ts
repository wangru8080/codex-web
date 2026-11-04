import { NextRequest, NextResponse } from "next/server";

import {
  ApiKeySettingsError,
  createApiKeyForUser,
  listApiKeysForUser,
} from "../../../../../server/api-key-settings";
import { isApiKeyPermissionProfile } from "../../../../../server/api-key-store";
import {
  authenticateWebRequest,
  isSameOriginRequest,
  readSessionCookie,
} from "../../../../../server/web-auth";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: NextRequest) {
  const user = await authenticateWebRequest(request);
  if (!user) return errorResponse(401, "登录已失效");
  try {
    const keys = await listApiKeysForUser(user, sessionToken(request));
    return NextResponse.json({ keys }, { headers: noStoreHeaders() });
  } catch (error) {
    return settingsError(error, "无法读取 API Key");
  }
}

export async function POST(request: NextRequest) {
  const user = await authenticateWebRequest(request);
  if (!user) return errorResponse(401, "登录已失效");
  if (!isSameOriginRequest(request)) return errorResponse(403, "请求来源无效");
  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return errorResponse(400, "请求体必须是 JSON 对象");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return errorResponse(400, "请求体必须是 JSON 对象");
  }
  if (!isApiKeyPermissionProfile(body.permissionProfile)) {
    return errorResponse(400, "API Key 权限类型无效");
  }
  try {
    const created = await createApiKeyForUser(
      user,
      sessionToken(request),
      body.name as string,
      body.permissionProfile,
    );
    return NextResponse.json(created, { headers: noStoreHeaders() });
  } catch (error) {
    return settingsError(error, "无法创建 API Key");
  }
}

function sessionToken(request: NextRequest): string | undefined {
  try {
    return readSessionCookie(request.headers.get("cookie"));
  } catch {
    return undefined;
  }
}

function settingsError(error: unknown, fallback: string): NextResponse {
  if (error instanceof ApiKeySettingsError) return errorResponse(error.statusCode, error.message);
  return errorResponse(500, fallback);
}

function errorResponse(status: number, message: string): NextResponse {
  return NextResponse.json({ error: message }, { status, headers: noStoreHeaders() });
}

function noStoreHeaders(): Record<string, string> {
  return {
    "Cache-Control": "no-store, max-age=0",
    Pragma: "no-cache",
    "X-Content-Type-Options": "nosniff",
  };
}
