import { NextResponse } from "next/server";

import { publicTurnstileConfig, readTurnstileConfig } from "../../../../../server/turnstile-config";
import { RuntimeBrokerClient } from "../../../../../server/runtime-broker-client";
import { runtimeBrokerSocket } from "../../../../../server/web-auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const brokerSocket = runtimeBrokerSocket();
  const brokerTurnstile = brokerSocket
    ? await new RuntimeBrokerClient(brokerSocket).readTurnstilePublic()
    : null;
  const config = brokerTurnstile?.rootManaged
    ? brokerTurnstile.config
    : publicTurnstileConfig(await readTurnstileConfig());
  return NextResponse.json(
    { turnstile: { enabled: config.enabled, siteKey: config.siteKey } },
    { headers: { "Cache-Control": "no-store" } },
  );
}
