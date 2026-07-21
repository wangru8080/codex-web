"use client";

import { useAppServerState } from "./AppServerProvider";

export function DiagnosticsBridgePanel() {
  const state = useAppServerState();
  const codexHome = state.initialize?.data.codexHome;

  return (
    <section className="flex flex-col gap-4 text-sm">
      <div>
        <h2 className="text-sm font-semibold text-foreground">App-server 诊断</h2>
        <p className="mt-1 text-xs text-muted-foreground">运行时连接与 bridge diagnostics（最多保留最近 100 条）</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <DiagnosticValue label="连接状态" value={state.connection.data} source={state.connection.source} />
        <DiagnosticValue label="CODEX_HOME" value={codexHome ?? "unsupported"} source={state.initialize?.source ?? "没有真实来源"} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <DiagnosticValue label="模型" value={state.models ? `${state.models.data.data.length} 个模型` : "unsupported"} source={state.models?.source ?? "没有真实来源"} />
        <DiagnosticValue label="诊断条目" value={`${state.diagnostics.length} 条`} source="web-bridge" />
      </div>
      <div className="rounded-md border border-border bg-background p-3">
        <div className="mb-2 text-xs font-medium text-muted-foreground">Diagnostics</div>
        {state.diagnostics.length === 0 ? (
          <div className="text-xs text-muted-foreground">暂无 diagnostics</div>
        ) : (
          <div className="max-h-96 space-y-2 overflow-auto">
            {state.diagnostics.map((entry, index) => (
              <div key={`${entry.source}-${index}`} className="rounded-md border border-border/70 bg-muted/20 p-2">
                <div className="flex items-start justify-between gap-3">
                  <span className="font-medium">{diagnosticLabel(entry.data)}</span>
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

function diagnosticLabel(value: unknown): string {
  if (typeof value !== "object" || value === null) return "诊断事件";
  const method = "method" in value && typeof value.method === "string" ? value.method : "";
  if (method.includes("disconnect") || method.includes("close")) return "连接关闭";
  if (method.includes("config")) return "配置警告";
  if (method.includes("stderr") || method.includes("output")) return "stderr 摘要";
  if (method) return method;
  return "未知通知";
}

function diagnosticSummary(value: unknown): string {
  if (typeof value === "object" && value !== null && "message" in value && typeof value.message === "string") {
    return value.message;
  }
  return JSON.stringify(value, null, 2);
}
