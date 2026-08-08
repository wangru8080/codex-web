import type { RuntimeBrokerRole, RuntimeBrokerUserConfig } from "./runtime-broker-config";
import type { TurnstileConfigUpdate, TurnstileConfig } from "./turnstile-config";
import type { TurnstileVerificationResult } from "./turnstile";

export type PublicTurnstileConfig = Pick<TurnstileConfig, "enabled" | "siteKey"> & {
  secretKeyConfigured: boolean;
};

export type BrokerPublicUser = Pick<
  RuntimeBrokerUserConfig,
  "id" | "email" | "osUser" | "home" | "codexHome" | "cwd" | "role"
>;

export type BrokerRequest =
  | { type: "login"; email: string; password: string; remoteAddress?: string }
  | { type: "verifySession"; token: string }
  | { type: "turnstile/readPublic" }
  | { type: "turnstile/verify"; responseToken: string; remoteAddress?: string }
  | { type: "turnstile/update"; token: string; update: TurnstileConfigUpdate; responseToken: string }
  | { type: "attachRuntime"; token: string };

export type BrokerSuccessResponse =
  | { ok: true; type: "login"; token: string; user: BrokerPublicUser }
  | { ok: true; type: "verifySession"; user: BrokerPublicUser }
  | { ok: true; type: "turnstilePublic"; rootManaged: boolean; config: PublicTurnstileConfig }
  | { ok: true; type: "turnstileVerified"; result: TurnstileVerificationResult }
  | { ok: true; type: "turnstileUpdated"; config: PublicTurnstileConfig }
  | { ok: true; type: "attached"; user: BrokerPublicUser; pid?: number };

export type BrokerErrorResponse = {
  ok: false;
  code: "invalid_credentials" | "unauthorized" | "forbidden" | "invalid_request" | "rate_limited" | "turnstile_failed" | "unavailable";
  error: string;
};

export type BrokerResponse = BrokerSuccessResponse | BrokerErrorResponse;

export function publicBrokerUser(user: RuntimeBrokerUserConfig): BrokerPublicUser {
  return {
    id: user.id,
    email: user.email,
    osUser: user.osUser,
    home: user.home,
    codexHome: user.codexHome,
    cwd: user.cwd,
    role: user.role,
  };
}

export function isBrokerAdmin(role: RuntimeBrokerRole): boolean {
  return role === "admin";
}
