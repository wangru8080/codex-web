import { NextResponse } from "next/server";

import { publicTurnstileConfig, readTurnstileConfig } from "../../../../../server/turnstile-config";
import { readSsoConfig } from "../../../../../server/sso-config";
import { RuntimeBrokerClient } from "../../../../../server/runtime-broker-client";
import { runtimeBrokerSocket } from "../../../../../server/web-auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const brokerSocket = runtimeBrokerSocket();
  const [brokerTurnstile, sso] = await Promise.all([
    brokerSocket ? new RuntimeBrokerClient(brokerSocket).readTurnstilePublic() : Promise.resolve(null),
    readSsoConfig(),
  ]);
  const config = brokerTurnstile?.rootManaged
    ? brokerTurnstile.config
    : publicTurnstileConfig(await readTurnstileConfig());
  return NextResponse.json(
    {
      authMode: sso.enabled ? "sso" : "local",
      sso: {
        enabled: sso.enabled,
        providerName: sso.providerName || "SSO",
      },
      turnstile: { enabled: config.enabled, siteKey: config.siteKey },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
