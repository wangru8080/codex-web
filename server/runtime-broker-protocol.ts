import type { RuntimeBrokerRole, RuntimeBrokerUserConfig } from "./runtime-broker-config";
import type { TurnstileConfigUpdate, TurnstileConfig } from "./turnstile-config";
import type { TurnstileVerificationResult } from "./turnstile";
import type { ApiKeyPermissionProfile, PublicApiKey } from "./api-key-store";
import type { JulesApiSessionMetadata } from "./jules-session-store";

export type PublicTurnstileConfig = Pick<TurnstileConfig, "enabled" | "siteKey"> & {
  secretKeyConfigured: boolean;
};

export type BrokerPublicUser = Pick<
  RuntimeBrokerUserConfig,
  "id" | "email" | "osUser" | "home" | "codexHome" | "cwd" | "role"
>;

export type BrokerRequest =
  | { type: "login"; email: string; password: string; remoteAddress?: string }
  | { type: "ssoLogin"; email: string }
  | { type: "verifySession"; token: string }
  | { type: "turnstile/readPublic" }
  | { type: "turnstile/verify"; responseToken: string; remoteAddress?: string }
  | { type: "turnstile/update"; token: string; update: TurnstileConfigUpdate; responseToken: string }
  | { type: "apiKeys/list"; token: string }
  | {
      type: "apiKeys/create";
      token: string;
      name: string;
      permissionProfile: ApiKeyPermissionProfile;
      authBinding: string;
    }
  | { type: "apiKeys/revoke"; token: string; id: string }
  | { type: "apiKey/verify"; apiKey: string; authBinding: string }
  | { type: "julesSessions/list"; apiKey: string; authBinding: string }
  | { type: "julesSessions/get"; apiKey: string; authBinding: string; threadId: string }
  | {
      type: "julesSessions/upsert";
      apiKey: string;
      authBinding: string;
      session: JulesApiSessionMetadata;
    }
  | {
      type: "julesSessions/approve";
      apiKey: string;
      authBinding: string;
      threadId: string;
      turnId: string;
      approvedAt: string;
    }
  | { type: "julesSessions/delete"; apiKey: string; authBinding: string; threadId: string }
  | { type: "attachRuntime"; token: string }
  | { type: "attachApiRuntime"; apiKey: string; authBinding: string };

export type BrokerSuccessResponse =
  | { ok: true; type: "login"; token: string; user: BrokerPublicUser }
  | { ok: true; type: "verifySession"; user: BrokerPublicUser }
  | { ok: true; type: "turnstilePublic"; rootManaged: boolean; config: PublicTurnstileConfig }
  | { ok: true; type: "turnstileVerified"; result: TurnstileVerificationResult }
  | { ok: true; type: "turnstileUpdated"; config: PublicTurnstileConfig }
  | { ok: true; type: "apiKeysList"; keys: PublicApiKey[] }
  | { ok: true; type: "apiKeyCreated"; key: string; metadata: PublicApiKey }
  | { ok: true; type: "apiKeyRevoked" }
  | {
      ok: true;
      type: "apiKeyVerified";
      user: BrokerPublicUser;
      keyId: string;
      permissionProfile: ApiKeyPermissionProfile;
    }
  | { ok: true; type: "julesSessionsList"; sessions: JulesApiSessionMetadata[] }
  | { ok: true; type: "julesSessionGet"; session: JulesApiSessionMetadata | null }
  | { ok: true; type: "julesSessionUpserted"; session: JulesApiSessionMetadata }
  | { ok: true; type: "julesSessionApproved"; session: JulesApiSessionMetadata | null }
  | { ok: true; type: "julesSessionDeleted"; deleted: boolean }
  | {
      ok: true;
      type: "attached";
      user: BrokerPublicUser;
      pid?: number;
      permissionProfile?: ApiKeyPermissionProfile;
    };

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
