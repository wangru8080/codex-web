"use client";

import { useAppServerState } from "./AppServerProvider";

export function DiagnosticsBridgePanel() {
  const state = useAppServerState();

  return (
    <section className="flex h-full flex-col gap-3 p-4 text-sm">
      <div>
        <h2 className="text-sm font-medium text-foreground">App-server 诊断</h2>
        <p className="mt-1 text-xs text-muted-foreground">source: {state.connection.source}</p>
      </div>
      <div className="rounded-md border border-border bg-muted/30 p-3">
        <div className="text-xs text-muted-foreground">连接状态</div>
        <div className="mt-1 font-medium">{state.connection.data}</div>
      </div>
      <div className="rounded-md border border-border bg-muted/30 p-3">
        <div className="text-xs text-muted-foreground">模型</div>
        <div className="mt-1 font-medium">
          {state.models ? `${state.models.data.data.length} 个模型` : "unsupported"}
        </div>
        <div className="mt-1 text-xs text-muted-foreground">
          {state.models?.source ?? "没有真实来源"}
        </div>
      </div>
      <div className="rounded-md border border-border bg-muted/30 p-3">
        <div className="text-xs text-muted-foreground">账号</div>
        <div className="mt-1 font-medium">
          {state.account?.data.account ? "已读取账号" : "未登录或隔离环境无账号"}
        </div>
        <div className="mt-1 text-xs text-muted-foreground">
          {state.account?.source ?? "没有真实来源"}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto rounded-md border border-border bg-background p-3">
        {state.diagnostics.length === 0 ? (
          <div className="text-xs text-muted-foreground">暂无 diagnostics</div>
        ) : (
          <pre className="whitespace-pre-wrap break-words text-xs">
            {JSON.stringify(state.diagnostics, null, 2)}
          </pre>
        )}
      </div>
    </section>
  );
}
