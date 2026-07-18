import { describe, expect, it } from "vitest";

import type { FuzzyFileSearchResult } from "@/codex/protocol/generated/FuzzyFileSearchResult";
import type { Thread } from "@/codex/protocol/generated/v2/Thread";
import {
  buildGlobalFileSearchRoots,
  buildGlobalThreadSearchParams,
  fuzzyFileToGlobalSearchResult,
  threadToGlobalSearchSession,
} from "./global-search-adapter";

function thread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: "thread-1",
    sessionId: "session-1",
    forkedFromId: null,
    parentThreadId: null,
    preview: "修复搜索",
    ephemeral: false,
    modelProvider: "openai",
    createdAt: 100,
    updatedAt: 200,
    recencyAt: 200,
    status: { type: "idle" },
    path: null,
    cwd: "/workspace/project",
    cliVersion: "0.0.0",
    source: "cli",
    threadSource: null,
    agentNickname: null,
    agentRole: null,
    gitInfo: null,
    name: null,
    turns: [],
    ...overrides,
  };
}

function file(overrides: Partial<FuzzyFileSearchResult> = {}): FuzzyFileSearchResult {
  return {
    root: "/workspace/project",
    path: "src/search.ts",
    match_type: "file",
    file_name: "search.ts",
    score: 90,
    indices: [4, 5, 6],
    ...overrides,
  };
}

describe("全局搜索 app-server 适配器", () => {
  it("会话查询使用 thread/list 的标题子串筛选和最近更新时间排序", () => {
    expect(buildGlobalThreadSearchParams("  搜索  ")).toEqual({
      archived: false,
      cursor: null,
      limit: 50,
      searchTerm: "搜索",
      sortDirection: "desc",
      sortKey: "recency_at",
    });
  });

  it("会话结果保留 thread/list 来源中的标题、项目和时间", () => {
    expect(threadToGlobalSearchSession(thread({ name: "全局搜索接线" }))).toEqual({
      type: "session",
      id: "thread-1",
      title: "全局搜索接线",
      projectName: "project",
      updatedAt: new Date(200_000).toISOString(),
    });
  });

  it("文件根目录合并当前 cwd 与真实 thread cwd，并过滤空值和重复项", () => {
    expect(buildGlobalFileSearchRoots(" /workspace/current ", [
      thread(),
      thread({ id: "thread-2", cwd: "/workspace/project" }),
      thread({ id: "thread-3", cwd: "" }),
    ])).toEqual(["/workspace/current", "/workspace/project"]);
  });

  it("文件命中关联同 root 的最近会话并生成绝对路径", () => {
    expect(fuzzyFileToGlobalSearchResult(file(), [thread()], null)).toEqual({
      type: "file",
      sessionId: "thread-1",
      sessionTitle: "修复搜索",
      path: "/workspace/project/src/search.ts",
      name: "search.ts",
      nodeType: "file",
    });
  });

  it("当前会话可承接当前 cwd 的文件命中", () => {
    expect(fuzzyFileToGlobalSearchResult(file({ root: "/workspace/current" }), [], {
      id: "active-thread",
      title: "当前会话",
      cwd: "/workspace/current",
    })?.sessionId).toBe("active-thread");
  });

  it("无法关联真实会话的文件命中不会伪造导航目标", () => {
    expect(fuzzyFileToGlobalSearchResult(file(), [], null)).toBeNull();
  });
});
