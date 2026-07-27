import { describe, expect, it, vi } from "vitest";

import { initialAppServerState } from "../app-server-state";
import { createAppServerStore } from "../app-server-store";

describe("app-server store", () => {
  it("只在状态引用变化时通知订阅者", () => {
    const store = createAppServerStore(initialAppServerState);
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    store.setState((current) => current);
    expect(listener).not.toHaveBeenCalled();

    store.setState((current) => ({
      ...current,
      diagnostics: [{ source: "web-bridge", data: { message: "diagnostic" } }],
    }));
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getState().connection).toBe(initialAppServerState.connection);
    expect(store.getState().threads).toBe(initialAppServerState.threads);

    unsubscribe();
    store.setState((current) => ({ ...current, diagnostics: [] }));
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("diagnostics 更新不会改变无关 selector 的快照", () => {
    const store = createAppServerStore(initialAppServerState);
    let selectedConnection = store.getState().connection;
    let connectionCommits = 0;
    store.subscribe(() => {
      const nextConnection = store.getState().connection;
      if (Object.is(nextConnection, selectedConnection)) return;
      selectedConnection = nextConnection;
      connectionCommits += 1;
    });

    store.setState((current) => ({
      ...current,
      diagnostics: [{ source: "web-bridge", data: { message: "diagnostic" } }],
    }));
    expect(connectionCommits).toBe(0);

    store.setState((current) => ({
      ...current,
      connection: { source: "web-bridge", data: "connected" },
    }));
    expect(connectionCommits).toBe(1);
  });
});
