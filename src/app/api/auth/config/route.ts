import { NextResponse } from "next/server";

import { publicTurnstileConfig, readTurnstileConfig } from "../../../../../server/turnstile-config";

export const dynamic = "force-dynamic";

export async function GET() {
  const config = publicTurnstileConfig(await readTurnstileConfig());
  return NextResponse.json(
    { turnstile: { enabled: config.enabled, siteKey: config.siteKey } },
    { headers: { "Cache-Control": "no-store" } },
  );
}
