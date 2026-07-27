import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  buildWebPerformanceScenarioMatrix,
  createHistoryFixtureJsonl,
  summarizeWebPerformanceResults,
  webPerformanceRunDirectoryName,
} from "../web-performance-baseline";

describe("Web 性能基准配置", () => {
  it("在 CDP 客户端类初始化后才执行顶层入口", () => {
    const source = readFileSync(
      resolve(process.cwd(), "scripts/web-performance-baseline.ts"),
      "utf8",
    );
    expect(source.indexOf("class CdpClient")).toBeGreaterThan(0);
    expect(source.lastIndexOf("await main();")).toBeGreaterThan(source.indexOf("class CdpClient"));
  });

  it("覆盖空、普通、长历史和设置首次/二次访问", () => {
    expect(buildWebPerformanceScenarioMatrix({
      ordinaryThreadId: "ordinary",
      longThreadId: "long",
      plainMarkdownThreadId: "plain",
      mathMarkdownThreadId: "math",
      mermaidMarkdownThreadId: "mermaid",
      codeMarkdownThreadId: "code",
    }))
      .toEqual([
        { name: "empty-chat-cold", path: "/chat", resetStorage: true },
        { name: "empty-chat-warm", path: "/chat", resetStorage: false },
        { name: "ordinary-history", path: "/chat/ordinary", resetStorage: false },
        { name: "long-history", path: "/chat/long", resetStorage: false },
        { name: "optional-markdown-plain", path: "/chat/plain", resetStorage: false },
        { name: "optional-markdown-math", path: "/chat/math", resetStorage: false },
        { name: "optional-markdown-mermaid", path: "/chat/mermaid", resetStorage: false },
        { name: "optional-markdown-code", path: "/chat/code", resetStorage: false },
        { name: "settings-first", path: "/settings/codex", resetStorage: false },
        { name: "settings-second", path: "/settings/codex", resetStorage: false },
      ]);
  });

  it("输出目录名包含模式、配置和毫秒，避免覆盖", () => {
    expect(webPerformanceRunDirectoryName(
      new Date("2026-07-23T12:34:56.789Z"),
      "production",
      "mcp-heavy",
    )).toBe("2026-07-23T12-34-56-789Z-production-mcp-heavy");
  });

  it("生成可被 app-server 读取的普通与长历史 fixture", () => {
    const fixture = createHistoryFixtureJsonl({
      threadId: "00000000-0000-4000-8000-000000000001",
      turnCount: 3,
      markerPrefix: "perf-ordinary",
      cwd: "/workspace",
    });
    const lines = fixture.trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);

    expect(lines).toHaveLength(19);
    expect(lines[0]).toMatchObject({ type: "session_meta" });
    expect(JSON.stringify(lines)).toContain("perf-ordinary-user-003");
    expect(JSON.stringify(lines)).toContain("```ts");
  });

  it("允许专项 Markdown 场景覆盖助手正文", () => {
    const fixture = createHistoryFixtureJsonl({
      threadId: "00000000-0000-4000-8000-000000000002",
      turnCount: 1,
      markerPrefix: "perf-math",
      cwd: "/workspace",
      assistantText: () => "perf-math-answer：$$x^2$$",
    });

    expect(fixture).toContain("perf-math-answer：$$x^2$$");
    expect(fixture).not.toContain("```ts");
  });

  it("汇总成功、失败、可交互时间和长任务", () => {
    const summary = summarizeWebPerformanceResults([
      {
        name: "one",
        ok: true,
        interactiveMs: 120,
        routeDurationMs: 30,
        inputLatencyMs: 8,
        longTaskCount: 1,
        maxLongTaskDuration: 55,
      },
      {
        name: "two",
        ok: false,
        error: "timeout",
        interactiveMs: null,
        routeDurationMs: null,
        inputLatencyMs: null,
        longTaskCount: 0,
        maxLongTaskDuration: null,
      },
    ]);

    expect(summary).toEqual({
      scenarioCount: 2,
      succeeded: 1,
      failed: 1,
      p95InteractiveMs: 120,
      p95RouteDurationMs: 30,
      p95InputLatencyMs: 8,
      totalLongTasks: 1,
      maxLongTaskDuration: 55,
    });
  });
});
