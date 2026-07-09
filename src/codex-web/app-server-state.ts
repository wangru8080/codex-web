import type { InitializeResponse } from "@/codex/protocol/generated/InitializeResponse";
import type { GetAccountResponse } from "@/codex/protocol/generated/v2/GetAccountResponse";
import type { ModelListResponse } from "@/codex/protocol/generated/v2/ModelListResponse";
import type { ThreadListResponse } from "@/codex/protocol/generated/v2/ThreadListResponse";
import type { ThreadReadResponse } from "@/codex/protocol/generated/v2/ThreadReadResponse";
import type { ThreadResumeResponse } from "@/codex/protocol/generated/v2/ThreadResumeResponse";
import type { JsonRpcNotification, JsonRpcRequest } from "@/codex/protocol/json-rpc";
import type { AppServerApprovalRequest } from "./approval-adapter";
import type { AppServerTurnState } from "./turn-reducer";

export type SourceBreadcrumb =
  | "app-server.initialize"
  | "app-server.initialized"
  | "app-server.model/list"
  | "app-server.account/read"
  | "app-server.thread/list"
  | "app-server.thread/read"
  | "app-server.thread/resume"
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
  threads: Sourced<ThreadListResponse> | null;
  selectedThread: Sourced<ThreadReadResponse> | null;
  resumedThread: Sourced<ThreadResumeResponse> | null;
  activeTurn: Sourced<AppServerTurnState> | null;
  pendingApproval: Sourced<AppServerApprovalRequest> | null;
  diagnostics: Array<Sourced<JsonRpcNotification | JsonRpcRequest | { message: string }>>;
};

export const initialAppServerState: CodexWebAppServerState = {
  connection: { source: "web-bridge", data: "idle" },
  initialize: null,
  models: null,
  account: null,
  threads: null,
  selectedThread: null,
  resumedThread: null,
  activeTurn: null,
  pendingApproval: null,
  diagnostics: [],
};
