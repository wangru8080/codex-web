import type { InitializeResponse } from "@/codex/protocol/generated/InitializeResponse";
import type { ConfigReadResponse } from "@/codex/protocol/generated/v2/ConfigReadResponse";
import type { GetAccountResponse } from "@/codex/protocol/generated/v2/GetAccountResponse";
import type { ModelListResponse } from "@/codex/protocol/generated/v2/ModelListResponse";
import type { ThreadListResponse } from "@/codex/protocol/generated/v2/ThreadListResponse";
import type { ThreadReadResponse } from "@/codex/protocol/generated/v2/ThreadReadResponse";
import type { ThreadSettings } from "@/codex/protocol/generated/v2/ThreadSettings";
import type { ThreadResumeResponse } from "@/codex/protocol/generated/v2/ThreadResumeResponse";
import type { ThreadGoal } from "@/codex/protocol/generated/v2/ThreadGoal";
import type { ThreadTokenUsage } from "@/codex/protocol/generated/v2/ThreadTokenUsage";
import type { JsonRpcNotification, JsonRpcRequest } from "@/codex/protocol/json-rpc";
import type { AppServerApprovalRequest } from "./approval-adapter";
import type { PlanImplementationPrompt } from "./plan-implementation-adapter";
import type { AppServerTurnState } from "./turn-reducer";

export type SourceBreadcrumb =
  | "app-server.initialize"
  | "app-server.initialized"
  | "app-server.model/list"
  | "app-server.account/read"
  | "app-server.config/read"
  | "app-server.thread/list"
  | "app-server.thread/read"
  | "app-server.thread/resume"
  | "app-server.thread/goal/get"
  | "app-server.thread/goal/updated"
  | "app-server.thread/goal/cleared"
  | "app-server.thread/tokenUsage/updated"
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

export type ConnectionStatus = "idle" | "connecting" | "connected" | "failed";

export type CodexWebAppServerState = {
  connection: Sourced<ConnectionStatus>;
  initialize: Sourced<InitializeResponse> | null;
  models: Sourced<ModelListResponse> | null;
  account: Sourced<GetAccountResponse> | null;
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
  planImplementationPromptByThreadId: Record<string, Sourced<PlanImplementationPrompt>>;
  pendingApprovals: AppServerApprovalRequest[];
  pendingApproval: Sourced<AppServerApprovalRequest> | null;
  diagnostics: Array<Sourced<JsonRpcNotification | JsonRpcRequest | { message: string }>>;
};

export const initialAppServerState: CodexWebAppServerState = {
  connection: { source: "web-bridge", data: "idle" },
  initialize: null,
  models: null,
  account: null,
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
  planImplementationPromptByThreadId: {},
  pendingApprovals: [],
  pendingApproval: null,
  diagnostics: [],
};
