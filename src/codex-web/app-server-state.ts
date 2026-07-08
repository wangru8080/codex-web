import type { InitializeResponse } from "@/codex/protocol/generated/InitializeResponse";
import type { GetAccountResponse } from "@/codex/protocol/generated/v2/GetAccountResponse";
import type { ModelListResponse } from "@/codex/protocol/generated/v2/ModelListResponse";
import type { JsonRpcNotification } from "@/codex/protocol/json-rpc";

export type SourceBreadcrumb =
  | "app-server.initialize"
  | "app-server.initialized"
  | "app-server.model/list"
  | "app-server.account/read"
  | "app-server.notification"
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
  diagnostics: Array<Sourced<JsonRpcNotification | { message: string }>>;
};

export const initialAppServerState: CodexWebAppServerState = {
  connection: { source: "web-bridge", data: "idle" },
  initialize: null,
  models: null,
  account: null,
  diagnostics: [],
};
