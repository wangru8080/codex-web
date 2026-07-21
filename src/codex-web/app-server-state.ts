import type { InitializeResponse } from "@/codex/protocol/generated/InitializeResponse";
import type { ConfigReadResponse } from "@/codex/protocol/generated/v2/ConfigReadResponse";
import type { GetAccountResponse } from "@/codex/protocol/generated/v2/GetAccountResponse";
import type { AccountLoginCompletedNotification } from "@/codex/protocol/generated/v2/AccountLoginCompletedNotification";
import type { ModelListResponse } from "@/codex/protocol/generated/v2/ModelListResponse";
import type { ThreadListResponse } from "@/codex/protocol/generated/v2/ThreadListResponse";
import type { ThreadReadResponse } from "@/codex/protocol/generated/v2/ThreadReadResponse";
import type { ThreadSettings } from "@/codex/protocol/generated/v2/ThreadSettings";
import type { ThreadResumeResponse } from "@/codex/protocol/generated/v2/ThreadResumeResponse";
import type { ThreadGoal } from "@/codex/protocol/generated/v2/ThreadGoal";
import type { ThreadTokenUsage } from "@/codex/protocol/generated/v2/ThreadTokenUsage";
import type { McpServerStatusUpdatedNotification } from "@/codex/protocol/generated/v2/McpServerStatusUpdatedNotification";
import type { JsonRpcNotification, JsonRpcRequest } from "@/codex/protocol/json-rpc";
import type { AppServerPendingRequest } from "./approval-adapter";
import type { PlanImplementationPrompt } from "./plan-implementation-adapter";
import type { AppServerTurnState } from "./turn-reducer";
import type { CrossClientUserMessage } from "./cross-client-sync";

export type SourceBreadcrumb =
  | "app-server.initialize"
  | "app-server.initialized"
  | "app-server.model/list"
  | "app-server.account/read"
  | "app-server.account/login/completed"
  | "app-server.config/read"
  | "app-server.thread/list"
  | "app-server.thread/read"
  | "app-server.thread/resume"
  | "app-server.thread/goal/get"
  | "app-server.thread/goal/updated"
  | "app-server.thread/goal/cleared"
  | "app-server.thread/tokenUsage/updated"
  | "app-server.mcpServer/startupStatus/updated"
  | "app-server.item/plan/delta"
  | "app-server.item/completed"
  | "app-server.turn/plan/updated"
  | "app-server.thread/turns/list"
  | "app-server.notification"
  | "app-server.serverRequest"
  | "web-bridge";

export type Sourced<T> = {
  source: SourceBreadcrumb;
  data: T;
};

export type ConnectionStatus = "idle" | "connecting" | "reconnecting" | "connected" | "failed";

export type CodexWebAppServerState = {
  connection: Sourced<ConnectionStatus>;
  initialize: Sourced<InitializeResponse> | null;
  models: Sourced<ModelListResponse> | null;
  account: Sourced<GetAccountResponse> | null;
  accountLoginCompletion: Sourced<AccountLoginCompletedNotification> | null;
  config: Sourced<ConfigReadResponse> | null;
  threads: Sourced<ThreadListResponse> | null;
  selectedThread: Sourced<ThreadReadResponse> | null;
  resumedThread: Sourced<ThreadResumeResponse> | null;
  threadSettingsByThreadId: Record<string, Sourced<ThreadSettings>>;
  activeTurn: Sourced<AppServerTurnState> | null;
  activeTurnsByThreadId: Record<string, Sourced<AppServerTurnState>>;
  turnSnapshots: Record<string, Sourced<AppServerTurnState>>;
  goalsByThreadId: Record<string, Sourced<ThreadGoal>>;
  threadTokenUsageByThreadId: Record<string, Sourced<ThreadTokenUsage>>;
  skillsRevision: number;
  mcpStartupByName: Record<string, Sourced<McpServerStatusUpdatedNotification>>;
  planImplementationPromptByThreadId: Record<string, Sourced<PlanImplementationPrompt>>;
  pendingApprovals: AppServerPendingRequest[];
  pendingApproval: Sourced<AppServerPendingRequest> | null;
  crossClientUserMessagesByThreadId: Record<string, CrossClientUserMessage[]>;
  latestCrossClientUserMessage: CrossClientUserMessage | null;
  diagnostics: Array<Sourced<JsonRpcNotification | JsonRpcRequest | { message: string }>>;
};

export const initialAppServerState: CodexWebAppServerState = {
  connection: { source: "web-bridge", data: "idle" },
  initialize: null,
  models: null,
  account: null,
  accountLoginCompletion: null,
  config: null,
  threads: null,
  selectedThread: null,
  resumedThread: null,
  threadSettingsByThreadId: {},
  activeTurn: null,
  activeTurnsByThreadId: {},
  turnSnapshots: {},
  goalsByThreadId: {},
  threadTokenUsageByThreadId: {},
  skillsRevision: 0,
  mcpStartupByName: {},
  planImplementationPromptByThreadId: {},
  pendingApprovals: [],
  pendingApproval: null,
  crossClientUserMessagesByThreadId: {},
  latestCrossClientUserMessage: null,
  diagnostics: [],
};
