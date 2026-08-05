import type { ConfigReadResponse } from "@/codex/protocol/generated/v2/ConfigReadResponse";
import type { PermissionProfile } from "@/types";

type RuntimePermissionSettings = {
  approvalPolicy?: unknown;
  approvalsReviewer?: unknown;
  sandbox?: unknown;
  sandboxPolicy?: unknown;
  activePermissionProfile?: { id?: unknown; extends?: unknown } | null;
};

export function permissionProfileFromRuntimeSettings(
  settings: RuntimePermissionSettings,
): PermissionProfile {
  const activeId = typeof settings.activePermissionProfile?.id === "string"
    ? settings.activePermissionProfile.id
    : "";
  const activeParent = typeof settings.activePermissionProfile?.extends === "string"
    ? settings.activePermissionProfile.extends
    : "";
  const profileId = activeId || activeParent;

  if (profileId === ":danger-full-access") return "full_access";
  if (profileId && profileId !== ":workspace") return "config";
  if (settings.approvalsReviewer === "auto_review") return "auto_approval";

  const sandbox = settings.sandboxPolicy ?? settings.sandbox;
  if (sandbox === "danger-full-access") return "full_access";
  if (sandbox === "read-only") return "config";
  if (typeof sandbox === "object" && sandbox !== null && "type" in sandbox
    && (sandbox as { type?: unknown }).type === "dangerFullAccess") {
    return "full_access";
  }
  if (typeof sandbox === "object" && sandbox !== null && "type" in sandbox
    && ["readOnly", "externalSandbox"].includes(String((sandbox as { type?: unknown }).type))) {
    return "config";
  }
  if (settings.approvalPolicy === "never") return "full_access";
  return "request_approval";
}

export function resolveNewChatPermissionDefault(
  response: ConfigReadResponse | null | undefined,
): PermissionProfile {
  const config = response?.config;
  if (!config) return "request_approval";
  const configuredProfile = (config as Record<string, unknown>).default_permissions;
  if (configuredProfile === ":danger-full-access") return "full_access";
  if (typeof configuredProfile === "string" && configuredProfile !== ":workspace") return "config";
  return permissionProfileFromRuntimeSettings({
    approvalPolicy: config.approval_policy,
    approvalsReviewer: config.approvals_reviewer,
    sandbox: config.sandbox_mode,
    activePermissionProfile: configuredProfile === ":workspace"
      ? { id: ":workspace", extends: null }
      : null,
  });
}
