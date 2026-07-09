import type { InitializeResponse } from "@/codex/protocol/generated/InitializeResponse";
import type { GetAccountResponse } from "@/codex/protocol/generated/v2/GetAccountResponse";
import type { ModelListResponse } from "@/codex/protocol/generated/v2/ModelListResponse";
import type { JsonRpcNotification, JsonRpcRequest } from "@/codex/protocol/json-rpc";
import type { AppServerApprovalRequest } from "./approval-adapter";
import type { AppServerTurnState } from "./turn-reducer";

export type SourceBreadcrumb =
  | "app-server.initialize"
  | "app-server.initialized"
  | "app-server.model/list"
  | "app-server.account/read"
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
  activeTurn: Sourced<AppServerTurnState> | null;
  pendingApproval: Sourced<AppServerApprovalRequest> | null;
  diagnostics: Array<Sourced<JsonRpcNotification | JsonRpcRequest | { message: string }>>;
};

export const initialAppServerState: CodexWebAppServerState = {
  connection: { source: "web-bridge", data: "idle" },
  initialize: null,
  models: null,
  account: null,
  activeTurn: null,
  pendingApproval: null,
  diagnostics: [],
};
