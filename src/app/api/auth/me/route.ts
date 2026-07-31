import { NextRequest, NextResponse } from "next/server";

import { authenticateWebRequest } from "../../../../../server/web-auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const user = await authenticateWebRequest(request);
  if (!user) {
    return NextResponse.json({ error: "登录已失效" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  return NextResponse.json(
    { user, source: "web-auth.session" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
