import { NextResponse } from "next/server";
import { homedir } from "node:os";
import type { NextRequest } from "next/server";
import { isAuthenticatedRequest } from "../../../../../server/web-auth";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export function GET(request: NextRequest) {
  if (!isAuthenticatedRequest(request)) {
    return NextResponse.json({ error: "登录已失效" }, { status: 401 });
  }
  const bridgeUrl = process.env.CODEX_WEB_BRIDGE_URL;
  const homeDirectory = process.env.CODEX_WEB_HOME_DIRECTORY?.trim() || homedir();

  if (!bridgeUrl) {
    return NextResponse.json(
      { error: "CODEX_WEB_BRIDGE_URL 未设置", homeDirectory },
      {
        status: 503,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }

  return NextResponse.json(
    { bridgeUrl, homeDirectory },
    {
      headers: { "Cache-Control": "no-store" },
    },
  );
}
