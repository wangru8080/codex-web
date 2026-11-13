import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { authenticateWebRequest } from "../../../../../server/web-auth";
import { resolveScreenShareConfig } from "../../../../../server/screen-share/config";
import { probeScreenShareCapability } from "../../../../../server/screen-share/probe";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: NextRequest) {
  const user = await authenticateWebRequest(request);
  if (!user) {
    return NextResponse.json({ error: "登录已失效" }, { status: 401 });
  }

  const config = resolveScreenShareConfig();
  const capability = probeScreenShareCapability(config);

  return NextResponse.json(
    { capability },
    {
      headers: { "Cache-Control": "no-store" },
    },
  );
}
