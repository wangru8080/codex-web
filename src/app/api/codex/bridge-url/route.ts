import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export function GET() {
  const bridgeUrl = process.env.CODEX_WEB_BRIDGE_URL;

  if (!bridgeUrl) {
    return NextResponse.json(
      { error: "CODEX_WEB_BRIDGE_URL 未设置" },
      {
        status: 503,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }

  return NextResponse.json(
    { bridgeUrl },
    {
      headers: { "Cache-Control": "no-store" },
    },
  );
}
