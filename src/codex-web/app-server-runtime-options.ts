import type { ThreadStartParams } from "@/codex/protocol/generated/v2/ThreadStartParams";
import type { TurnStartParams } from "@/codex/protocol/generated/v2/TurnStartParams";
import type { ConfigReadResponse } from "@/codex/protocol/generated/v2/ConfigReadResponse";
import type { PermissionProfile } from "@/types";

type ThreadRuntimeOptions = Pick<
  ThreadStartParams,
  "approvalPolicy" | "approvalsReviewer" | "sandbox" | "config"
>;

type TurnRuntimeOptions = Pick<
  TurnStartParams,
  "approvalPolicy" | "approvalsReviewer" | "sandboxPolicy"
>;

export function threadRuntimeOptions(
  profile: PermissionProfile,
  effectiveConfig: ConfigReadResponse,
): ThreadRuntimeOptions {
  return {
    ...approvalOptions(profile),
    ...threadSandboxOptions(profile),
    ...webSearchConfigOverride(effectiveConfig),
  };
}

export function turnRuntimeOptions(
  profile: PermissionProfile,
  cwd: string,
): TurnRuntimeOptions {
  const sandboxPolicy = (() => {
    if (profile === "full_access") {
      return { type: "dangerFullAccess" } as const;
    }
    if (profile === "config") {
      return undefined;
    }
    return {
      type: "workspaceWrite" as const,
      writableRoots: [cwd],
      networkAccess: false,
      excludeTmpdirEnvVar: false,
      excludeSlashTmp: false,
    };
  })();

  return {
    ...approvalOptions(profile),
    ...(sandboxPolicy ? { sandboxPolicy } : {}),
  };
}

function approvalOptions(profile: PermissionProfile): Pick<
  ThreadStartParams,
  "approvalPolicy" | "approvalsReviewer"
> {
  if (profile === "config") return {};
  if (profile === "full_access") {
    return { approvalPolicy: "never", approvalsReviewer: "user" };
  }
  return {
    approvalPolicy: "on-request",
    approvalsReviewer: profile === "auto_approval" ? "auto_review" : "user",
  };
}

function threadSandboxOptions(profile: PermissionProfile): Pick<ThreadStartParams, "sandbox"> {
  if (profile === "config") return {};
  return { sandbox: profile === "full_access" ? "danger-full-access" : "workspace-write" };
}

function webSearchConfigOverride(
  effectiveConfig: ConfigReadResponse,
): Pick<ThreadStartParams, "config"> {
  const webSearch = effectiveConfig.config.web_search;
  return webSearch ? { config: { web_search: webSearch } } : {};
}
