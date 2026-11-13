"use client";

import { useEffect, useState } from "react";

import { useAppServerSelector } from "./AppServerProvider";
import { useTranslation } from "@/hooks/useTranslation";

type AuthUser = {
  id: string;
  email: string;
  osUser: string;
  home: string;
  codexHome: string;
  cwd: string;
  role: string;
};

type AuthMeResponse = { user?: AuthUser; source?: string };

export function DiagnosticsBridgePanel() {
  const { locale } = useTranslation();
  const isEnglish = locale === "en";
  const connection = useAppServerSelector((state) => state.connection);
  const initialize = useAppServerSelector((state) => state.initialize);
  const models = useAppServerSelector((state) => state.models);
  const diagnostics = useAppServerSelector((state) => state.diagnostics);
  const codexHome = initialize?.data.codexHome;
  const [authUser, setAuthUser] = useState<AuthMeResponse | null>(null);

  useEffect(() => {
    let disposed = false;
    void fetch("/api/auth/me", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) return null;
        return await response.json() as AuthMeResponse;
      })
      .then((response) => {
        if (!disposed) setAuthUser(response);
      })
      .catch(() => {
        if (!disposed) setAuthUser(null);
      });
    return () => {
      disposed = true;
    };
  }, []);

  const noSource = isEnglish ? "No source breadcrumb" : "没有真实来源";

  return (
    <section className="flex flex-col gap-4 text-sm">
      <div>
        <h2 className="text-sm font-semibold text-foreground">
          {isEnglish ? "App-server Diagnostics" : "App-server 诊断"}
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          {isEnglish
            ? "Runtime connection and bridge diagnostics (keeps up to the last 100 entries)"
            : "运行时连接与 bridge diagnostics（最多保留最近 100 条）"}
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <DiagnosticValue label={isEnglish ? "Connection Status" : "连接状态"} value={connection.data} source={connection.source} />
        <DiagnosticValue label="CODEX_HOME" value={codexHome ?? "unsupported"} source={initialize?.source ?? noSource} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <DiagnosticValue
          label={isEnglish ? "Models" : "模型"}
          value={models ? (isEnglish ? `${models.data.data.length} models` : `${models.data.data.length} 个模型`) : "unsupported"}
          source={models?.source ?? noSource}
        />
        <DiagnosticValue
          label={isEnglish ? "Diagnostic Entries" : "诊断条目"}
          value={isEnglish ? `${diagnostics.length} entries` : `${diagnostics.length} 条`}
          source="web-bridge"
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <DiagnosticValue label={isEnglish ? "Authenticated User" : "认证用户"} value={authUser?.user?.email ?? "unsupported"} source={authUser?.source ?? noSource} />
        <DiagnosticValue label={isEnglish ? "OS User" : "OS 用户"} value={authUser?.user?.osUser ?? "unsupported"} source={authUser?.source ?? noSource} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <DiagnosticValue label={isEnglish ? "Authenticated User CODEX_HOME" : "认证用户 CODEX_HOME"} value={authUser?.user?.codexHome ?? "unsupported"} source={authUser?.source ?? noSource} />
        <DiagnosticValue label={isEnglish ? "Authenticated User CWD" : "认证用户 cwd"} value={authUser?.user?.cwd ?? "unsupported"} source={authUser?.source ?? noSource} />
      </div>
      <div className="rounded-md border border-border bg-background p-3">
        <div className="mb-2 text-xs font-medium text-muted-foreground">Diagnostics</div>
        {diagnostics.length === 0 ? (
          <div className="text-xs text-muted-foreground">
            {isEnglish ? "No diagnostics yet" : "暂无 diagnostics"}
          </div>
        ) : (
          <div className="max-h-96 space-y-2 overflow-auto">
            {diagnostics.map((entry, index) => (
              <div key={`${entry.source}-${index}`} className="rounded-md border border-border/70 bg-muted/20 p-2">
                <div className="flex items-start justify-between gap-3">
                  <span className="font-medium">{diagnosticLabel(entry.data, isEnglish)}</span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">{entry.source}</span>
                </div>
                <pre className="mt-1 whitespace-pre-wrap break-words text-xs text-muted-foreground">{diagnosticSummary(entry.data)}</pre>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function DiagnosticValue({ label, value, source }: { label: string; value: string; source: string }) {
  return (
    <div className="rounded-md border border-border bg-muted/30 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 break-all font-medium">{value}</div>
      <div className="mt-1 text-xs text-muted-foreground">{source}</div>
    </div>
  );
}

function diagnosticLabel(value: unknown, isEnglish = false): string {
  if (typeof value !== "object" || value === null) return isEnglish ? "Diagnostic Event" : "诊断事件";
  const method = "method" in value && typeof value.method === "string" ? value.method : "";
  if (method.includes("disconnect") || method.includes("close")) return isEnglish ? "Connection Closed" : "连接关闭";
  if (method.includes("config")) return isEnglish ? "Config Warning" : "配置警告";
  if (method.includes("stderr") || method.includes("output")) return isEnglish ? "stderr Summary" : "stderr 摘要";
  if (method) return method;
  return isEnglish ? "Unknown Notification" : "未知通知";
}

function diagnosticSummary(value: unknown): string {
  if (typeof value === "object" && value !== null && "message" in value && typeof value.message === "string") {
    return value.message;
  }
  return JSON.stringify(value, null, 2);
}
