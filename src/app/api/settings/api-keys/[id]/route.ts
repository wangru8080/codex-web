import { NextRequest, NextResponse } from "next/server";

import { ApiKeySettingsError, revokeApiKeyForUser } from "../../../../../../server/api-key-settings";
import {
  authenticateWebRequest,
  isSameOriginRequest,
  readSessionCookie,
} from "../../../../../../server/web-auth";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const user = await authenticateWebRequest(request);
  if (!user) return errorResponse(401, "登录已失效");
  if (!isSameOriginRequest(request)) return errorResponse(403, "请求来源无效");
  const { id } = await context.params;
  try {
    await revokeApiKeyForUser(user, sessionToken(request), id);
    return NextResponse.json({ revoked: true }, { headers: noStoreHeaders() });
  } catch (error) {
    if (error instanceof ApiKeySettingsError) return errorResponse(error.statusCode, error.message);
    return errorResponse(500, "无法撤销 API Key");
  }
}

function sessionToken(request: NextRequest): string | undefined {
  try {
    return readSessionCookie(request.headers.get("cookie"));
  } catch {
    return undefined;
  }
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
