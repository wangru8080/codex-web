import { NextResponse } from "next/server";
import { homedir } from "node:os";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export function GET() {
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
