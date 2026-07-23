import type { CodexWebAppServerState } from "./app-server-state";

export type AppServerStateUpdater =
  | CodexWebAppServerState
  | ((current: CodexWebAppServerState) => CodexWebAppServerState);

export type AppServerStore = {
  getState: () => CodexWebAppServerState;
  setState: (updater: AppServerStateUpdater) => void;
  subscribe: (listener: () => void) => () => void;
};

export function createAppServerStore(initialState: CodexWebAppServerState): AppServerStore {
  let state = initialState;
  const listeners = new Set<() => void>();

  return {
    getState: () => state,
    setState: (updater) => {
      const nextState = typeof updater === "function" ? updater(state) : updater;
      if (Object.is(nextState, state)) return;
      state = nextState;
      for (const listener of listeners) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
