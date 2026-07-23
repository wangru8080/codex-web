import type { ProfilerOnRenderCallback } from "react";

export const webPerformanceQueryParameter = "codexPerformance";

export type WebPerformanceEntry = {
  name: string;
  entryType: string;
  startTime: number;
  duration: number;
};

export type WebPerformanceProfilerCommit = {
  id: string;
  phase: "mount" | "update" | "nested-update";
  actualDuration: number;
  baseDuration: number;
  startTime: number;
  commitTime: number;
};

export type WebPerformanceSnapshot = {
  collectedAt: string;
  scenario: string | null;
  entries: WebPerformanceEntry[];
  longTasks: Array<Pick<WebPerformanceEntry, "name" | "startTime" | "duration">>;
  profilerCommits: WebPerformanceProfilerCommit[];
  summary: {
    entryCount: number;
    longTaskCount: number;
    maxLongTaskDuration: number | null;
    profiler: Record<
      string,
      {
        commitCount: number;
        totalActualDuration: number;
        maxActualDuration: number;
        p95ActualDuration: number | null;
      }
    >;
  };
};

type CollectorOptions = {
  capacity?: number;
  scenario?: string | null;
};

export class WebPerformanceCollector {
  private readonly capacity: number;
  private readonly entries: WebPerformanceEntry[] = [];
  private readonly profilerCommits: WebPerformanceProfilerCommit[] = [];
  private scenario: string | null;

  constructor(options: CollectorOptions = {}) {
    this.capacity = Math.max(1, options.capacity ?? 2_000);
    this.scenario = options.scenario ?? null;
  }

  setScenario(scenario: string | null): void {
    this.scenario = scenario;
  }

  recordEntry(entry: WebPerformanceEntry): void {
    pushBounded(this.entries, { ...entry }, this.capacity);
  }

  recordProfilerCommit(commit: WebPerformanceProfilerCommit): void {
    pushBounded(this.profilerCommits, { ...commit }, this.capacity);
  }

  reset(scenario: string | null = this.scenario): void {
    this.entries.length = 0;
    this.profilerCommits.length = 0;
    this.scenario = scenario;
  }

  snapshot(): WebPerformanceSnapshot {
    const entries = this.entries.map((entry) => ({ ...entry }));
    const profilerCommits = this.profilerCommits.map((commit) => ({ ...commit }));
    const longTasks = entries
      .filter((entry) => entry.entryType === "longtask")
      .map(({ name, startTime, duration }) => ({ name, startTime, duration }));
    const profiler = summarizeProfiler(profilerCommits);

    return {
      collectedAt: new Date().toISOString(),
      scenario: this.scenario,
      entries,
      longTasks,
      profilerCommits,
      summary: {
        entryCount: entries.length,
        longTaskCount: longTasks.length,
        maxLongTaskDuration: longTasks.length
          ? Math.max(...longTasks.map((entry) => entry.duration))
          : null,
        profiler,
      },
    };
  }
}

export function isWebPerformanceCollectionEnabled(search: string): boolean {
  const value = new URLSearchParams(search).get(webPerformanceQueryParameter);
  return value === "1" || value === "true";
}

export function percentile95(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(sorted.length * 0.95) - 1] ?? null;
}

function pushBounded<T>(items: T[], item: T, capacity: number): void {
  items.push(item);
  if (items.length > capacity) items.splice(0, items.length - capacity);
}

function summarizeProfiler(
  commits: readonly WebPerformanceProfilerCommit[],
): WebPerformanceSnapshot["summary"]["profiler"] {
  const durationsById = new Map<string, number[]>();
  for (const commit of commits) {
    const durations = durationsById.get(commit.id) ?? [];
    durations.push(commit.actualDuration);
    durationsById.set(commit.id, durations);
  }

  return Object.fromEntries(
    [...durationsById.entries()].map(([id, durations]) => [
      id,
      {
        commitCount: durations.length,
        totalActualDuration: durations.reduce((total, duration) => total + duration, 0),
        maxActualDuration: Math.max(...durations),
        p95ActualDuration: percentile95(durations),
      },
    ]),
  );
}

let browserCollector: WebPerformanceCollector | null = null;

export function getBrowserWebPerformanceCollector(): WebPerformanceCollector | null {
  if (typeof window === "undefined") return null;
  if (!isWebPerformanceCollectionEnabled(window.location.search)) return null;
  browserCollector ??= new WebPerformanceCollector();
  return browserCollector;
}

export function recordBrowserPerformanceEntry(entry: WebPerformanceEntry): void {
  getBrowserWebPerformanceCollector()?.recordEntry(entry);
}

export const recordBrowserProfilerCommit: ProfilerOnRenderCallback = (
  id,
  phase,
  actualDuration,
  baseDuration,
  startTime,
  commitTime,
) => {
  getBrowserWebPerformanceCollector()?.recordProfilerCommit({
    id,
    phase,
    actualDuration,
    baseDuration,
    startTime,
    commitTime,
  });
};

export type WebPerformanceBrowserApi = {
  mark: (name: string) => void;
  reset: (scenario?: string | null) => void;
  setScenario: (scenario: string | null) => void;
  snapshot: () => WebPerformanceSnapshot;
};

export function installWebPerformanceBrowserApi(): WebPerformanceBrowserApi | null {
  const collector = getBrowserWebPerformanceCollector();
  if (!collector || typeof window === "undefined") return null;

  const api: WebPerformanceBrowserApi = {
    mark(name) {
      performance.mark(name);
      const entry = performance.getEntriesByName(name, "mark").at(-1);
      if (entry) collector.recordEntry(toSerializableEntry(entry));
    },
    reset(scenario = null) {
      performance.clearMarks();
      performance.clearMeasures();
      collector.reset(scenario);
    },
    setScenario(scenario) {
      collector.setScenario(scenario);
    },
    snapshot() {
      return collector.snapshot();
    },
  };
  window.__CODEX_WEB_PERFORMANCE__ = api;
  return api;
}

export function toSerializableEntry(entry: PerformanceEntry): WebPerformanceEntry {
  return {
    name: entry.name,
    entryType: entry.entryType,
    startTime: entry.startTime,
    duration: entry.duration,
  };
}

declare global {
  interface Window {
    __CODEX_WEB_PERFORMANCE__?: WebPerformanceBrowserApi;
  }
}
