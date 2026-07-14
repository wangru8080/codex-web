import type { ThreadStartParams } from "@/codex/protocol/generated/v2/ThreadStartParams";
import type { TurnStartParams } from "@/codex/protocol/generated/v2/TurnStartParams";
import type { ConfigReadResponse } from "@/codex/protocol/generated/v2/ConfigReadResponse";
import type { SandboxPolicy } from "@/codex/protocol/generated/v2/SandboxPolicy";
import type { AskForApproval } from "@/codex/protocol/generated/v2/AskForApproval";
import type { ApprovalsReviewer } from "@/codex/protocol/generated/v2/ApprovalsReviewer";
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
  effectiveConfig?: ConfigReadResponse,
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
      writableRoots: effectiveConfig?.config.sandbox_workspace_write?.writable_roots?.length
        ? effectiveConfig.config.sandbox_workspace_write.writable_roots
        : [cwd],
      networkAccess: effectiveConfig?.config.sandbox_workspace_write?.network_access ?? false,
      excludeTmpdirEnvVar: effectiveConfig?.config.sandbox_workspace_write?.exclude_tmpdir_env_var ?? false,
      excludeSlashTmp: effectiveConfig?.config.sandbox_workspace_write?.exclude_slash_tmp ?? false,
    };
  })();

  return {
    ...approvalOptions(profile),
    ...(sandboxPolicy ? { sandboxPolicy } : {}),
  };
}

export type ThreadPermissionUpdateOptions = {
  approvalPolicy?: AskForApproval;
  approvalsReviewer?: ApprovalsReviewer;
  permissions?: string;
  sandboxPolicy?: SandboxPolicy;
};

export function threadPermissionUpdateOptions(
  profile: PermissionProfile,
  _cwd: string,
  configuredProfileId?: string | null,
  effectiveConfig?: ConfigReadResponse,
): ThreadPermissionUpdateOptions {
  if (profile === "config") {
    if (configuredProfileId) return { permissions: configuredProfileId };
    const config = effectiveConfig?.config;
    const sandboxMode = config?.sandbox_mode ?? "workspace-write";
    const workspaceWrite = config?.sandbox_workspace_write;
    return {
      approvalPolicy: config?.approval_policy ?? "on-request",
      approvalsReviewer: config?.approvals_reviewer ?? "user",
      ...(sandboxMode === "danger-full-access"
        ? { sandboxPolicy: { type: "dangerFullAccess" } }
        : sandboxMode === "read-only"
          ? { sandboxPolicy: { type: "readOnly", networkAccess: false } }
          : {
              sandboxPolicy: {
                type: "workspaceWrite",
                writableRoots: workspaceWrite?.writable_roots ?? [],
                networkAccess: workspaceWrite?.network_access ?? false,
                excludeTmpdirEnvVar: workspaceWrite?.exclude_tmpdir_env_var ?? false,
                excludeSlashTmp: workspaceWrite?.exclude_slash_tmp ?? false,
              },
            }),
    };
  }
  if (profile === "full_access") {
    return {
      approvalPolicy: "never",
      approvalsReviewer: "user",
      permissions: ":danger-full-access",
    };
  }
  return {
    approvalPolicy: "on-request",
    approvalsReviewer: profile === "auto_approval" ? "auto_review" : "user",
    permissions: ":workspace",
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
