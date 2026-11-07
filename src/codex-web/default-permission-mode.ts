import type { ConfigEdit } from "@/codex/protocol/generated/v2/ConfigEdit";
import type { ConfigReadResponse } from "@/codex/protocol/generated/v2/ConfigReadResponse";
import type { PermissionProfile } from "@/types";

import { resolveNewChatPermissionDefault } from "./thread-permission-settings";

export type BuiltInDefaultPermissionMode = Extract<
  PermissionProfile,
  "request_approval" | "auto_approval" | "full_access"
>;

export const BUILT_IN_DEFAULT_PERMISSION_MODES: readonly BuiltInDefaultPermissionMode[] = [
  "request_approval",
  "auto_approval",
  "full_access",
];

export function defaultPermissionModeFromConfig(
  response: ConfigReadResponse | null | undefined,
): PermissionProfile {
  return resolveNewChatPermissionDefault(response);
}

/**
 * Writes a complete permission mode instead of only changing
 * default_permissions. The app-server keeps approval_policy and sandbox_mode
 * independently, so partial edits can produce a mixed mode that looks correct
 * in one surface but behaves differently when a new thread starts.
 */
export function defaultPermissionModeConfigEdits(
  mode: BuiltInDefaultPermissionMode,
): ConfigEdit[] {
  if (mode === "full_access") {
    return [
      { keyPath: "default_permissions", value: ":danger-full-access", mergeStrategy: "replace" },
      { keyPath: "approvals_reviewer", value: "user", mergeStrategy: "replace" },
      { keyPath: "approval_policy", value: "never", mergeStrategy: "replace" },
      { keyPath: "sandbox_mode", value: "danger-full-access", mergeStrategy: "replace" },
    ];
  }

  return [
    { keyPath: "default_permissions", value: ":workspace", mergeStrategy: "replace" },
    {
      keyPath: "approvals_reviewer",
      value: mode === "auto_approval" ? "auto_review" : "user",
      mergeStrategy: "replace",
    },
    { keyPath: "approval_policy", value: "on-request", mergeStrategy: "replace" },
    { keyPath: "sandbox_mode", value: "workspace-write", mergeStrategy: "replace" },
  ];
}
