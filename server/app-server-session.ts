import type { JsonRpcClient } from "./json-rpc-client";
import type { JsonRpcNotification } from "../src/codex/protocol/json-rpc";
import type { InitializeParams } from "../src/codex/protocol/generated/InitializeParams";
import type { InitializeResponse } from "../src/codex/protocol/generated/InitializeResponse";
import type { GetAccountResponse } from "../src/codex/protocol/generated/v2/GetAccountResponse";
import type { ModelListResponse } from "../src/codex/protocol/generated/v2/ModelListResponse";
import { appServerInitializeCapabilities } from "../src/codex-web/app-server-capabilities";
import { APP_VERSION } from "../src/lib/app-version";

export type SourceBreadcrumb =
  | "app-server.initialize"
  | "app-server.initialized"
  | "app-server.model/list"
  | "app-server.account/read"
  | "app-server.notification";

export type Sourced<T> = {
  source: SourceBreadcrumb;
  data: T;
};

export type AppServerSessionTransport = {
  request(method: string, params?: unknown): Promise<unknown>;
  notify(method: string, params?: unknown): void | Promise<void>;
  onNotification(listener: (notification: JsonRpcNotification) => void): void;
};

export function transportFromJsonRpcClient(client: JsonRpcClient): AppServerSessionTransport {
  return {
    request: (method, params) => client.request(method, params),
    notify: (method, params) => client.notify(method, params),
    onNotification: (listener) => {
      client.on("notification", listener);
    },
  };
}

export type BootstrapResult = {
  initialize: Sourced<InitializeResponse>;
  models: Sourced<ModelListResponse>;
  account: Sourced<GetAccountResponse>;
};

const clientInfo = {
  name: "codex_web",
  title: "Codex Web",
  version: APP_VERSION,
};

export class AppServerSession {
  readonly diagnostics: Array<Sourced<JsonRpcNotification>> = [];

  constructor(private readonly client: AppServerSessionTransport) {
    this.client.onNotification((notification) => {
      this.diagnostics.push({ source: "app-server.notification", data: notification });
      if (this.diagnostics.length > 100) {
        this.diagnostics.splice(0, this.diagnostics.length - 100);
      }
    });
  }

  async bootstrap(): Promise<BootstrapResult> {
    const initialize = await this.initialize();
    this.initialized();
    const [models, account] = await Promise.all([this.listModels(), this.readAccount()]);

    return { initialize, models, account };
  }

  async initialize(): Promise<Sourced<InitializeResponse>> {
    const params: InitializeParams = {
      clientInfo,
      capabilities: appServerInitializeCapabilities(),
    };

    const result = await this.client.request("initialize", params);
    return { source: "app-server.initialize", data: result as InitializeResponse };
  }

  initialized(): Sourced<null> {
    this.client.notify("initialized");
    return { source: "app-server.initialized", data: null };
  }

  async listModels(): Promise<Sourced<ModelListResponse>> {
    const result = await this.client.request("model/list", { includeHidden: false });
    return { source: "app-server.model/list", data: result as ModelListResponse };
  }

  async readAccount(): Promise<Sourced<GetAccountResponse>> {
    const result = await this.client.request("account/read", { refreshToken: false });
    return { source: "app-server.account/read", data: result as GetAccountResponse };
  }
}
