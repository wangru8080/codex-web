import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { authenticateWebRequest } from "../../../../../server/web-auth";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: NextRequest) {
  const user = await authenticateWebRequest(request);
  if (!user) {
    return NextResponse.json({ error: "登录已失效" }, { status: 401 });
  }
  const bridgeUrl = process.env.CODEX_WEB_BRIDGE_URL;
  const homeDirectory = user.home;

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
    { bridgeUrl, homeDirectory, user },
    {
      headers: { "Cache-Control": "no-store" },
    },
  );
}
