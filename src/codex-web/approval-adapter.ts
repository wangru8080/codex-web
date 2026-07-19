import type { CommandExecutionRequestApprovalParams } from "@/codex/protocol/generated/v2/CommandExecutionRequestApprovalParams";
import type { CommandExecutionRequestApprovalResponse } from "@/codex/protocol/generated/v2/CommandExecutionRequestApprovalResponse";
import type { FileChangeRequestApprovalParams } from "@/codex/protocol/generated/v2/FileChangeRequestApprovalParams";
import type { FileChangeRequestApprovalResponse } from "@/codex/protocol/generated/v2/FileChangeRequestApprovalResponse";
import type { GrantedPermissionProfile } from "@/codex/protocol/generated/v2/GrantedPermissionProfile";
import type { PermissionsRequestApprovalParams } from "@/codex/protocol/generated/v2/PermissionsRequestApprovalParams";
import type { PermissionsRequestApprovalResponse } from "@/codex/protocol/generated/v2/PermissionsRequestApprovalResponse";
import type { McpServerElicitationAction } from "@/codex/protocol/generated/v2/McpServerElicitationAction";
import type { McpServerElicitationRequestParams } from "@/codex/protocol/generated/v2/McpServerElicitationRequestParams";
import type { McpServerElicitationRequestResponse } from "@/codex/protocol/generated/v2/McpServerElicitationRequestResponse";
import type { ToolRequestUserInputParams } from "@/codex/protocol/generated/v2/ToolRequestUserInputParams";
import type { ToolRequestUserInputResponse } from "@/codex/protocol/generated/v2/ToolRequestUserInputResponse";
import type { JsonValue } from "@/codex/protocol/generated/serde_json/JsonValue";
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

export type AppServerUserInputRequest =
  | {
      requestId: JsonRpcId;
      method: "item/tool/requestUserInput";
      threadId: string;
      turnId: string;
      itemId: string;
      params: ToolRequestUserInputParams;
    }
  | {
      requestId: JsonRpcId;
      method: "mcpServer/elicitation/request";
      threadId: string;
      turnId: string | null;
      serverName: string;
      params: McpServerElicitationRequestParams;
    };

export type AppServerPendingRequest = AppServerApprovalRequest | AppServerUserInputRequest;

export type AppServerRequestResponseInput =
  | { type: "approval"; decision: AppServerApprovalDecision }
  | { type: "userInput"; answers: ToolRequestUserInputResponse["answers"] }
  | {
      type: "elicitation";
      action: McpServerElicitationAction;
      content?: JsonValue;
      _meta?: JsonValue;
    };

export type AppServerRequestResponse =
  | CommandExecutionRequestApprovalResponse
  | FileChangeRequestApprovalResponse
  | PermissionsRequestApprovalResponse
  | ToolRequestUserInputResponse
  | McpServerElicitationRequestResponse;

export function mapServerRequestToPendingRequest(request: JsonRpcRequest): AppServerPendingRequest | null {
  const approval = mapServerRequestToApproval(request);
  if (approval) {
    return approval;
  }

  if (request.method === "item/tool/requestUserInput") {
    const params = request.params as ToolRequestUserInputParams;
    return {
      requestId: request.id,
      method: request.method,
      threadId: params.threadId,
      turnId: params.turnId,
      itemId: params.itemId,
      params,
    };
  }

  if (request.method === "mcpServer/elicitation/request") {
    const params = request.params as McpServerElicitationRequestParams;
    return {
      requestId: request.id,
      method: request.method,
      threadId: params.threadId,
      turnId: params.turnId,
      serverName: params.serverName,
      params,
    };
  }

  return null;
}

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

export function buildServerRequestResponse(
  request: AppServerPendingRequest,
  input: AppServerRequestResponseInput,
): AppServerRequestResponse {
  if (
    request.method === "item/commandExecution/requestApproval" ||
    request.method === "item/fileChange/requestApproval" ||
    request.method === "item/permissions/requestApproval"
  ) {
    if (input.type !== "approval") {
      throw new Error("响应类型与 app-server request 不匹配");
    }
    return buildApprovalResponse(request, input.decision);
  }

  if (request.method === "item/tool/requestUserInput") {
    if (input.type !== "userInput") {
      throw new Error("响应类型与 app-server request 不匹配");
    }
    return { answers: input.answers };
  }

  if (input.type !== "elicitation") {
    throw new Error("响应类型与 app-server request 不匹配");
  }
  if (input.action !== "accept") {
    return { action: input.action, content: null, _meta: null };
  }
  return {
    action: input.action,
    content: input.content ?? null,
    _meta: input._meta ?? null,
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
