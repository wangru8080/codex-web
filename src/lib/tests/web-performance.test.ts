import { describe, expect, it } from "vitest";

import {
  WebPerformanceCollector,
  isWebPerformanceCollectionEnabled,
  percentile95,
} from "../web-performance";

describe("Web 性能采集", () => {
  it("只在查询参数显式开启时启用", () => {
    expect(isWebPerformanceCollectionEnabled("")).toBe(false);
    expect(isWebPerformanceCollectionEnabled("?codexPerformance=0")).toBe(false);
    expect(isWebPerformanceCollectionEnabled("?codexPerformance=1")).toBe(true);
    expect(isWebPerformanceCollectionEnabled("?x=1&codexPerformance=true")).toBe(true);
  });

  it("计算排序无关的 P95", () => {
    expect(percentile95([])).toBeNull();
    expect(percentile95([8])).toBe(8);
    expect(percentile95([100, 10, 40, 20, 30])).toBe(100);
    expect(percentile95(Array.from({ length: 100 }, (_, index) => index + 1))).toBe(95);
  });

  it("按固定容量保留最新记录并返回不可变快照", () => {
    const collector = new WebPerformanceCollector({ capacity: 2, scenario: "long-history" });

    collector.recordEntry({ name: "first", entryType: "mark", startTime: 1, duration: 0 });
    collector.recordEntry({ name: "second", entryType: "measure", startTime: 2, duration: 12 });
    collector.recordEntry({ name: "third", entryType: "longtask", startTime: 3, duration: 75 });
    collector.recordProfilerCommit({
      id: "MessageList",
      phase: "update",
      actualDuration: 9,
      baseDuration: 11,
      startTime: 4,
      commitTime: 14,
    });

    const snapshot = collector.snapshot();
    expect(snapshot.scenario).toBe("long-history");
    expect(snapshot.entries.map((entry) => entry.name)).toEqual(["second", "third"]);
    expect(snapshot.longTasks).toEqual([{ name: "third", startTime: 3, duration: 75 }]);
    expect(snapshot.profilerCommits).toHaveLength(1);

    snapshot.entries.length = 0;
    expect(collector.snapshot().entries).toHaveLength(2);
  });

  it("汇总组件提交次数、P95 和长任务", () => {
    const collector = new WebPerformanceCollector({ capacity: 10 });
    for (const duration of [4, 8, 16, 32, 64]) {
      collector.recordProfilerCommit({
        id: "MessageItem",
        phase: "update",
        actualDuration: duration,
        baseDuration: duration,
        startTime: duration,
        commitTime: duration + 1,
      });
    }
    collector.recordEntry({ name: "long", entryType: "longtask", startTime: 10, duration: 60 });

    expect(collector.snapshot().summary).toEqual({
      entryCount: 1,
      longTaskCount: 1,
      maxLongTaskDuration: 60,
      profiler: {
        MessageItem: {
          commitCount: 5,
          totalActualDuration: 124,
          maxActualDuration: 64,
          p95ActualDuration: 64,
        },
      },
    });
  });
});
