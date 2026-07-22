import { NextRequest, NextResponse } from "next/server";

import { isSameOriginRequest, WEB_AUTH_COOKIE } from "../../../../../server/web-auth";

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: "请求来源无效" }, { status: 403 });
  }
  const response = NextResponse.json({ ok: true });
  response.cookies.set(WEB_AUTH_COOKIE, "", {
    httpOnly: true,
    sameSite: "strict",
    secure: request.nextUrl.protocol === "https:",
    path: "/",
    maxAge: 0,
  });
  return response;
}
