import type { CommandExecutionRequestApprovalParams } from "@/codex/protocol/generated/v2/CommandExecutionRequestApprovalParams";
import type { CommandExecutionRequestApprovalResponse } from "@/codex/protocol/generated/v2/CommandExecutionRequestApprovalResponse";
import type { FileChangeRequestApprovalParams } from "@/codex/protocol/generated/v2/FileChangeRequestApprovalParams";
import type { FileChangeRequestApprovalResponse } from "@/codex/protocol/generated/v2/FileChangeRequestApprovalResponse";
import type { GrantedPermissionProfile } from "@/codex/protocol/generated/v2/GrantedPermissionProfile";
import type { PermissionsRequestApprovalParams } from "@/codex/protocol/generated/v2/PermissionsRequestApprovalParams";
import type { PermissionsRequestApprovalResponse } from "@/codex/protocol/generated/v2/PermissionsRequestApprovalResponse";
import type { JsonRpcId, JsonRpcRequest } from "@/codex/protocol/json-rpc";
import type { PermissionRequestEvent } from "@/types";

export type AppServerApprovalDecision = "allow" | "allow_session" | "deny";

export type AppServerApprovalMethod =
  | "item/commandExecution/requestApproval"
  | "item/fileChange/requestApproval"
  | "item/permissions/requestApproval";

export type AppServerApprovalRequest =
  | {
      requestId: JsonRpcId;
      method: "item/commandExecution/requestApproval";
      threadId: string;
      turnId: string;
      itemId: string;
      params: CommandExecutionRequestApprovalParams;
      permission: PermissionRequestEvent;
    }
  | {
      requestId: JsonRpcId;
      method: "item/fileChange/requestApproval";
      threadId: string;
      turnId: string;
      itemId: string;
      params: FileChangeRequestApprovalParams;
      permission: PermissionRequestEvent;
    }
  | {
      requestId: JsonRpcId;
      method: "item/permissions/requestApproval";
      threadId: string;
      turnId: string;
      itemId: string;
      params: PermissionsRequestApprovalParams;
      permission: PermissionRequestEvent;
    };

export function mapServerRequestToApproval(request: JsonRpcRequest): AppServerApprovalRequest | null {
  if (request.method === "item/commandExecution/requestApproval") {
    const params = request.params as CommandExecutionRequestApprovalParams;
    return {
      requestId: request.id,
      method: request.method,
      threadId: params.threadId,
      turnId: params.turnId,
      itemId: params.itemId,
      params,
      permission: {
        permissionRequestId: String(request.id),
        toolName: "Bash",
        toolUseId: params.itemId,
        decisionReason: params.reason ?? undefined,
        toolInput: {
          command: params.command,
          cwd: params.cwd,
          environmentId: params.environmentId,
          commandActions: params.commandActions,
          networkApprovalContext: params.networkApprovalContext,
        },
        suggestions: [{ type: "app-server-command-approval", behavior: "acceptForSession" }],
      },
    };
  }

  if (request.method === "item/fileChange/requestApproval") {
    const params = request.params as FileChangeRequestApprovalParams;
    return {
      requestId: request.id,
      method: request.method,
      threadId: params.threadId,
      turnId: params.turnId,
      itemId: params.itemId,
      params,
      permission: {
        permissionRequestId: String(request.id),
        toolName: "Patch",
        toolUseId: params.itemId,
        decisionReason: params.reason ?? undefined,
        blockedPath: params.grantRoot ?? undefined,
        toolInput: {
          itemId: params.itemId,
          grantRoot: params.grantRoot,
          reason: params.reason,
        },
        suggestions: [{ type: "app-server-file-change-approval", behavior: "acceptForSession" }],
      },
    };
  }

  if (request.method === "item/permissions/requestApproval") {
    const params = request.params as PermissionsRequestApprovalParams;
    return {
      requestId: request.id,
      method: request.method,
      threadId: params.threadId,
      turnId: params.turnId,
      itemId: params.itemId,
      params,
      permission: {
        permissionRequestId: String(request.id),
        toolName: "Permissions",
        toolUseId: params.itemId,
        decisionReason: params.reason ?? undefined,
        toolInput: {
          cwd: params.cwd,
          environmentId: params.environmentId,
          permissions: params.permissions,
        },
        suggestions: [{ type: "app-server-permissions-approval", behavior: "session" }],
      },
    };
  }

  return null;
}

export function buildApprovalResponse(
  approval: AppServerApprovalRequest,
  decision: AppServerApprovalDecision,
): CommandExecutionRequestApprovalResponse | FileChangeRequestApprovalResponse | PermissionsRequestApprovalResponse {
  if (approval.method === "item/commandExecution/requestApproval") {
    return {
      decision: decision === "deny" ? "decline" : decision === "allow_session" ? "acceptForSession" : "accept",
    };
  }

  if (approval.method === "item/fileChange/requestApproval") {
    return {
      decision: decision === "deny" ? "decline" : decision === "allow_session" ? "acceptForSession" : "accept",
    };
  }

  if (decision === "deny") {
    return {
      permissions: {},
      scope: "turn",
    };
  }

  return {
    permissions: grantedPermissionsFromRequest(approval.params.permissions),
    scope: decision === "allow_session" ? "session" : "turn",
  };
}

function grantedPermissionsFromRequest(
  permissions: PermissionsRequestApprovalParams["permissions"],
): GrantedPermissionProfile {
  return {
    ...(permissions.network ? { network: permissions.network } : {}),
    ...(permissions.fileSystem ? { fileSystem: permissions.fileSystem } : {}),
  };
}
