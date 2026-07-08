"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";

import type { InitializeResponse } from "@/codex/protocol/generated/InitializeResponse";
import type { GetAccountResponse } from "@/codex/protocol/generated/v2/GetAccountResponse";
import type { ModelListResponse } from "@/codex/protocol/generated/v2/ModelListResponse";
import { AppServerBrowserClient } from "./app-server-browser-client";
import { initialAppServerState, type CodexWebAppServerState } from "./app-server-state";

const AppServerContext = createContext<CodexWebAppServerState>(initialAppServerState);

export function AppServerProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<CodexWebAppServerState>(initialAppServerState);
  const bridgeUrl = useMemo(() => process.env.NEXT_PUBLIC_CODEX_BRIDGE_URL ?? "", []);

  useEffect(() => {
    if (!bridgeUrl) {
      setState((current) => ({
        ...current,
        connection: { source: "web-bridge", data: "failed" },
        diagnostics: appendDiagnostic(current.diagnostics, {
          source: "web-bridge",
          data: { message: "NEXT_PUBLIC_CODEX_BRIDGE_URL 未设置" },
        }),
      }));
      return;
    }

    let disposed = false;
    const client = new AppServerBrowserClient(bridgeUrl);
    client.onNotification((notification) => {
      setState((current) => ({
        ...current,
        diagnostics: appendDiagnostic(current.diagnostics, {
          source: "app-server.notification",
          data: notification,
        }),
      }));
    });

    async function bootstrap() {
      setState((current) => ({ ...current, connection: { source: "web-bridge", data: "connecting" } }));
      try {
        await client.connect();
        const initialize = (await client.request("initialize", {
          clientInfo: { name: "codex_web", title: "Codex Web", version: "0.0.0" },
          capabilities: null,
        })) as InitializeResponse;
        client.notify("initialized");
        const [models, account] = await Promise.all([
          client.request("model/list", { includeHidden: false }) as Promise<ModelListResponse>,
          client.request("account/read", { refreshToken: false }) as Promise<GetAccountResponse>,
        ]);

        if (disposed) {
          return;
        }

        setState((current) => ({
          ...current,
          connection: { source: "web-bridge", data: "connected" },
          initialize: { source: "app-server.initialize", data: initialize },
          models: { source: "app-server.model/list", data: models },
          account: { source: "app-server.account/read", data: account },
        }));
      } catch (error) {
        if (disposed) {
          return;
        }
        setState((current) => ({
          ...current,
          connection: { source: "web-bridge", data: "failed" },
          diagnostics: appendDiagnostic(current.diagnostics, {
            source: "web-bridge",
            data: { message: error instanceof Error ? error.message : String(error) },
          }),
        }));
      }
    }

    void bootstrap();

    return () => {
      disposed = true;
      client.close();
    };
  }, [bridgeUrl]);

  return <AppServerContext.Provider value={state}>{children}</AppServerContext.Provider>;
}

export function useAppServerState(): CodexWebAppServerState {
  return useContext(AppServerContext);
}

function appendDiagnostic(
  diagnostics: CodexWebAppServerState["diagnostics"],
  entry: CodexWebAppServerState["diagnostics"][number],
): CodexWebAppServerState["diagnostics"] {
  return [...diagnostics, entry].slice(-100);
}
