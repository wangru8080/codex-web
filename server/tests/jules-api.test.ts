import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import type { Thread } from "../../src/codex/protocol/generated/v2/Thread";
import type { Turn } from "../../src/codex/protocol/generated/v2/Turn";
import { ApiKeyStore, apiKeyStatePath } from "../api-key-store";
import { handleJulesApi } from "../jules-api";
import { JULES_API_THREAD_SOURCE, JulesSessionStore, julesSessionStatePath, type JulesApiSessionMetadata } from "../jules-session-store";
import { sourceIdForCwd } from "../jules-model";
import type { JulesRuntime } from "../jules-runtime";
import { readWebAuthBinding, webAuthCredentialVersion } from "../web-auth";

type FakeRuntime = JulesRuntime & {
  calls: Array<{ method: string; params: unknown }>;
  threads: Thread[];
  archivedThreads: Thread[];
  closed: boolean;
  gitStatusOutput?: string;
};

function turn(overrides: Partial<Turn> = {}): Turn {
  return {
    id: "turn-1",
    items: [],
    itemsView: "full",
    status: "completed",
    error: null,
    startedAt: 1_800_000_000,
    completedAt: 1_800_000_010,
    durationMs: 10_000,
    ...overrides,
  };
}

function thread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: "thread_api_1",
    sessionId: "session-1",
    forkedFromId: null,
    parentThreadId: null,
    preview: "Build the feature",
    ephemeral: false,
    modelProvider: "openai",
    createdAt: 1_800_000_000,
    updatedAt: 1_800_000_010,
    recencyAt: null,
    status: { type: "idle" },
    path: null,
    cwd: process.cwd(),
    cliVersion: "1.0.0",
    source: "appServer",
    threadSource: JULES_API_THREAD_SOURCE,
    agentNickname: null,
    agentRole: null,
    gitInfo: { sha: "abc", branch: "main", originUrl: "https://github.com/acme/app.git" },
    name: "Feature",
    turns: [],
    ...overrides,
  };
}

function fakeRuntime(threads: Thread[] = [], archivedThreads: Thread[] = []): FakeRuntime {
  const runtime: FakeRuntime = {
    user: {
      id: "test@admin.com",
      email: "test@admin.com",
      osUser: "tester",
      home: "/home/tester",
      codexHome: "/home/tester/.codex",
      cwd: process.cwd(),
      role: "admin",
    },
    permissionProfile: "workspace",
    calls: [],
    threads,
    archivedThreads,
    closed: false,
    request: async (method, params) => {
      runtime.calls.push({ method, params });
      if (method === "thread/list") {
        const archived = (params as { archived?: boolean } | undefined)?.archived === true;
        return {
          data: archived ? runtime.archivedThreads : runtime.threads,
          nextCursor: null,
          backwardsCursor: null,
        };
      }
      if (method === "thread/read") {
        const threadId = (params as { threadId: string }).threadId;
        const found = [...runtime.threads, ...runtime.archivedThreads].find((candidate) => candidate.id === threadId);
        if (!found) throw new Error("thread not found");
        return { thread: found };
      }
      if (method === "thread/start") {
        const start = params as { cwd: string };
        const created = thread({
          id: "created_thread_1",
          cwd: start.cwd,
          name: null,
          preview: "",
          createdAt: 1_800_000_020,
          updatedAt: 1_800_000_020,
          turns: [],
        });
        runtime.threads.unshift(created);
        return { thread: created };
      }
      if (method === "thread/name/set") {
        const { threadId, name } = params as { threadId: string; name: string };
        const found = runtime.threads.find((candidate) => candidate.id === threadId);
        if (found) found.name = name;
        return {};
      }
      if (method === "turn/start") {
        const { threadId, input } = params as { threadId: string; input: Array<{ text?: string }> };
        const found = runtime.threads.find((candidate) => candidate.id === threadId);
        if (!found) throw new Error("thread not found");
        const started = turn({
          id: `turn-${found.turns.length + 1}`,
          status: "inProgress",
          completedAt: null,
          startedAt: 1_800_000_020 + found.turns.length,
          items: [{
            type: "userMessage",
            id: `user-${found.turns.length + 1}`,
            clientId: null,
            content: [{ type: "text", text: input[0]?.text ?? "", text_elements: [] }],
          }],
        });
        found.turns.push(started);
        found.status = { type: "active", activeFlags: [] };
        found.updatedAt = started.startedAt ?? found.updatedAt;
        return { turn: started };
      }
      if (method === "thread/resume") {
        const found = runtime.threads.find((candidate) => candidate.id === (params as { threadId: string }).threadId);
        if (!found) throw new Error("thread not found");
        found.status = { type: "idle" };
        return { thread: found };
      }
      if (method === "turn/steer") {
        return { turnId: (params as { expectedTurnId: string }).expectedTurnId };
      }
      if (method === "thread/archive" || method === "thread/unarchive") {
        const threadId = (params as { threadId: string }).threadId;
        const from = method === "thread/archive" ? runtime.threads : runtime.archivedThreads;
        const to = method === "thread/archive" ? runtime.archivedThreads : runtime.threads;
        const index = from.findIndex((candidate) => candidate.id === threadId);
        if (index < 0) throw new Error("thread not found");
        to.unshift(...from.splice(index, 1));
        return {};
      }
      if (method === "thread/delete") {
        const threadId = (params as { threadId: string }).threadId;
        runtime.threads = runtime.threads.filter((candidate) => candidate.id !== threadId);
        runtime.archivedThreads = runtime.archivedThreads.filter((candidate) => candidate.id !== threadId);
        return {};
      }
      if (method === "command/exec") {
        const { command } = params as { command: string[] };
        const joined = command.join(" ");
        if (joined === "git rev-parse --abbrev-ref HEAD") {
          return { exitCode: 0, stdout: "main\n", stderr: "" };
        }
        if (joined === "git status --porcelain") {
          return { exitCode: 0, stdout: runtime.gitStatusOutput ?? "", stderr: "" };
        }
        if (joined === "git show-ref --verify --quiet refs/heads/develop") {
          return { exitCode: 1, stdout: "", stderr: "" };
        }
        if (joined === "git show-ref --verify --quiet refs/remotes/origin/develop") {
          return { exitCode: 0, stdout: "", stderr: "" };
        }
        if (joined === "git checkout -b develop origin/develop") {
          return { exitCode: 0, stdout: "Switched to a new branch 'develop'\n", stderr: "" };
        }
        return { exitCode: 1, stdout: "", stderr: `unexpected git command: ${joined}` };
      }
      throw new Error(`unexpected method ${method}`);
    },
    notify: () => undefined,
    close: () => {
      runtime.closed = true;
    },
  };
  return runtime;
}

async function fixture(profile: "workspace" | "full_access" = "workspace") {
  const state = await mkdtemp(join(tmpdir(), "codex-web-jules-api-"));
  const env = {
    CODEX_WEB_STATE: state,
    CODEX_WEB_LOGIN_EMAIL: "test@admin.com",
    CODEX_WEB_LOGIN_PASSWORD: "123456",
    CODEX_WEB_SESSION_SECRET: "0123456789abcdef0123456789abcdef",
    CODEX_HOME: join(state, "codex-home"),
  };
  const store = new ApiKeyStore(apiKeyStatePath(env));
  const created = await store.create({
    userId: "test@admin.com",
    name: "Test",
    permissionProfile: profile,
    authBinding: readWebAuthBinding(env),
    userCredentialVersion: webAuthCredentialVersion(env)!,
  });
  return {
    state,
    env,
    key: created.key,
    store,
    metadataStore: new JulesSessionStore(julesSessionStatePath(env)),
  };
}

function request(
  path: string,
  key: string | null,
  init: RequestInit = {},
): Request {
  const headers = new Headers(init.headers);
  if (key) headers.set("x-goog-api-key", key);
  return new Request(`http://localhost:3000/v1alpha${path}`, { ...init, headers });
}

async function call(
  requestValue: Request,
  path: string[],
  env: Record<string, string>,
  runtime: FakeRuntime,
) {
  const runtimeFactory = vi.fn(async () => runtime);
  const response = await handleJulesApi(requestValue, path, {
    env,
    runtimeFactory,
    now: () => new Date("2026-11-04T10:00:00.000Z"),
  });
  return { response, runtimeFactory, body: await response.json() as Record<string, unknown> };
}

describe("Jules-compatible API", () => {
  it("rejects cookie-only, query, Authorization, and cross-origin key usage", async () => {
    const { env, key } = await fixture();
    const runtime = fakeRuntime();

    const missing = await call(request("/sources", null), ["sources"], env, runtime);
    expect(missing.response.status).toBe(401);
    expect(missing.runtimeFactory).not.toHaveBeenCalled();

    const query = await call(
      request(`/sources?key=${encodeURIComponent(key)}`, null),
      ["sources"],
      env,
      runtime,
    );
    expect(query.response.status).toBe(400);

    const authorization = await call(
      request("/sources", null, { headers: { Authorization: `Bearer ${key}` } }),
      ["sources"],
      env,
      runtime,
    );
    expect(authorization.response.status).toBe(400);

    const cookieOnly = await call(
      request("/sources", null, { headers: { cookie: "codex_web_session=fake" } }),
      ["sources"],
      env,
      runtime,
    );
    expect(cookieOnly.response.status).toBe(401);

    const crossOrigin = await call(
      request("/sources", key, { headers: { origin: "https://evil.example" } }),
      ["sources"],
      env,
      runtime,
    );
    expect(crossOrigin.response.status).toBe(403);
    expect(crossOrigin.runtimeFactory).not.toHaveBeenCalled();
  });

  it("lists only real configured sources without exposing cwd", async () => {
    const { env, key } = await fixture();
    const runtime = fakeRuntime([
      thread({ cwd: process.cwd() }),
      thread({
        id: "other_thread",
        cwd: "/workspace/other",
        gitInfo: { sha: "def", branch: "main", originUrl: "https://github.com/other/repo.git" },
      }),
    ]);
    const result = await call(request("/sources", key), ["sources"], env, runtime);
    expect(result.response.status).toBe(200);
    const sources = result.body.sources as Array<Record<string, unknown>>;
    expect(sources).toHaveLength(2);
    expect(sources.some((source) => source.id === "github/acme/app")).toBe(true);
    expect(sources.some((source) => source.id === "github/other/repo")).toBe(true);
    expect((sources.find((source) => source.id === "github/acme/app") as { name?: string })?.name)
      .toBe("sources/github/acme/app");
    expect(JSON.stringify(sources)).not.toContain("cwd");
    expect(JSON.stringify(sources)).not.toContain("/workspace/other");

    const fetched = await call(
      request("/sources/github/acme/app", key),
      ["sources", "github", "acme", "app"],
      env,
      runtime,
    );
    expect(fetched.response.status).toBe(200);
    expect(fetched.body).toMatchObject({ id: "github/acme/app", name: "sources/github/acme/app" });
    expect(runtime.closed).toBe(true);
  });

  it("creates API-tagged sessions, starts a real turn, and hides browser-created threads", async () => {
    const { env, key, metadataStore } = await fixture();
    const browserThread = thread({ id: "browser_thread", threadSource: "codex_web" });
    const runtime = fakeRuntime([browserThread]);
    const result = await call(
      request("/sessions", key, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: "Build the feature", title: "Feature" }),
      }),
      ["sessions"],
      env,
      runtime,
    );
    expect(result.response.status).toBe(200);
    expect(result.body).toMatchObject({
      id: "created_thread_1",
      title: "Feature",
      prompt: "Build the feature",
      state: "IN_PROGRESS",
    });
    expect(runtime.calls.find((entry) => entry.method === "thread/start")?.params)
      .toMatchObject({ threadSource: JULES_API_THREAD_SOURCE, serviceName: JULES_API_THREAD_SOURCE });
    expect(runtime.calls.find((entry) => entry.method === "turn/start")?.params)
      .toMatchObject({ threadId: "created_thread_1" });
    expect(await metadataStore.get("test@admin.com", "created_thread_1")).toMatchObject({
      requirePlanApproval: false,
      sourceId: "github/acme/app",
    });

    const listed = await call(request("/sessions", key), ["sessions"], env, runtime);
    expect(listed.response.status).toBe(200);
    expect((listed.body.sessions as Array<{ id: string }>).map((session) => session.id))
      .toEqual(["created_thread_1"]);
  });

  it("accepts AUTO_CREATE_PR and applies GitHub startingBranch selection", async () => {
    const { env, key, metadataStore } = await fixture();
    const runtime = fakeRuntime([thread({ cwd: process.cwd() })]);
    const automation = await call(
      request("/sessions", key, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: "Build",
          automationMode: "AUTO_CREATE_PR",
          sourceContext: {
            source: "sources/github/acme/app",
            githubRepoContext: { startingBranch: "develop" },
          },
        }),
      }),
      ["sessions"],
      env,
      runtime,
    );
    expect(automation.response.status).toBe(200);
    expect(automation.body).toMatchObject({
      sourceContext: {
        source: "sources/github/acme/app",
        githubRepoContext: { startingBranch: "develop" },
      },
    });
    expect(runtime.calls.filter((entry) => entry.method === "command/exec").map((entry) => entry.params))
      .toEqual([
        expect.objectContaining({ command: ["git", "rev-parse", "--abbrev-ref", "HEAD"] }),
        expect.objectContaining({ command: ["git", "status", "--porcelain"] }),
        expect.objectContaining({ command: ["git", "show-ref", "--verify", "--quiet", "refs/heads/develop"] }),
        expect.objectContaining({ command: ["git", "show-ref", "--verify", "--quiet", "refs/remotes/origin/develop"] }),
        expect.objectContaining({ command: ["git", "checkout", "-b", "develop", "origin/develop"] }),
      ]);
    const start = runtime.calls.find((entry) => entry.method === "thread/start")?.params;
    expect(start).toMatchObject({
      cwd: process.cwd(),
      developerInstructions: expect.stringContaining("AUTO_CREATE_PR"),
    });
    expect((start as { developerInstructions: string }).developerInstructions)
      .toContain("gh pr create");
    expect(await metadataStore.get("test@admin.com", "created_thread_1")).toMatchObject({
      automationMode: "AUTO_CREATE_PR",
      startingBranch: "develop",
      initialGitSha: "abc",
    });

    const dirtyRuntime = fakeRuntime([thread({ cwd: process.cwd() })]);
    dirtyRuntime.gitStatusOutput = " M src/app.ts\n";
    const dirty = await call(
      request("/sessions", key, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: "Build",
          sourceContext: {
            source: "sources/github/acme/app",
            githubRepoContext: { startingBranch: "develop" },
          },
        }),
      }),
      ["sessions"],
      env,
      dirtyRuntime,
    );
    expect(dirty.response.status).toBe(400);
    expect((dirty.body.error as { status: string }).status).toBe("FAILED_PRECONDITION");
    expect(dirtyRuntime.calls.filter((entry) => entry.method === "thread/start")).toHaveLength(0);
  });

  it("rejects arbitrary source paths and browser-thread metadata", async () => {
    const { env, key, metadataStore } = await fixture();
    const browserThread = thread({ id: "browser_thread", threadSource: "codex_web" });
    await metadataStore.upsert({
      threadId: "browser_thread",
      userId: "test@admin.com",
      sourceId: sourceIdForCwd(process.cwd()),
      prompt: "Browser prompt",
      title: "Browser",
      requirePlanApproval: false,
      approvedPlanTurnId: null,
      approvedPlanAt: null,
    });
    const runtime = fakeRuntime([browserThread]);
    const arbitrary = await call(
      request("/sessions", key, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: "Build", sourceContext: { source: "sources/arbitrary-path" } }),
      }),
      ["sessions"],
      env,
      runtime,
    );
    expect(arbitrary.response.status).toBe(404);
    const hidden = await call(request("/sessions/browser_thread", key), ["sessions", "browser_thread"], env, runtime);
    expect(hidden.response.status).toBe(404);
  });

  it("steers an active turn and approves a real pending plan", async () => {
    const { env, key, metadataStore } = await fixture();
    const active = thread({
      id: "active_thread",
      turns: [turn({ id: "active_turn", status: "inProgress", completedAt: null })],
    });
    const planThread = thread({
      id: "plan_thread",
      turns: [turn({
        id: "plan_turn",
        items: [{ type: "plan", id: "plan_item", text: "1. Inspect\n2. Implement" }],
      })],
    });
    const runtime = fakeRuntime([active, planThread]);
    for (const value of [active, planThread]) {
      await metadataStore.upsert(sessionMetadata(value.id, value.id === "plan_thread"));
    }
    const send = await call(
      request("/sessions/active_thread:sendMessage", key, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: "Also add tests" }),
      }),
      ["sessions", "active_thread:sendMessage"],
      env,
      runtime,
    );
    expect(send.response.status).toBe(200);
    expect(runtime.calls.find((entry) => entry.method === "turn/steer")?.params)
      .toMatchObject({ threadId: "active_thread", expectedTurnId: "active_turn" });

    const approve = await call(
      request("/sessions/plan_thread:approvePlan", key, { method: "POST", body: "{}" }),
      ["sessions", "plan_thread:approvePlan"],
      env,
      runtime,
    );
    expect(approve.response.status).toBe(200);
    const started = runtime.calls.filter((entry) => entry.method === "turn/start").at(-1);
    expect(started?.params).toMatchObject({
      threadId: "plan_thread",
      collaborationMode: { mode: "default" },
    });
    expect(await metadataStore.get("test@admin.com", "plan_thread")).toMatchObject({
      approvedPlanTurnId: "plan_turn",
      approvedPlanAt: "2026-11-04T10:00:00.000Z",
    });
  });

  it("resumes an unloaded thread before starting a turn and rejects approval while a turn is running", async () => {
    const { env, key, metadataStore } = await fixture();
    const plan = turn({
      id: "plan_turn",
      items: [{ type: "plan", id: "plan_item", text: "1. Inspect" }],
    });
    const unloaded = thread({ id: "unloaded_thread", status: { type: "notLoaded" }, turns: [plan] });
    const revising = thread({
      id: "revising_thread",
      turns: [plan, turn({ id: "revise_turn", status: "inProgress", completedAt: null })],
    });
    const runtime = fakeRuntime([unloaded, revising]);
    for (const value of [unloaded, revising]) await metadataStore.upsert(sessionMetadata(value.id, true));

    const approve = await call(
      request("/sessions/unloaded_thread:approvePlan", key, { method: "POST", body: "{}" }),
      ["sessions", "unloaded_thread:approvePlan"],
      env,
      runtime,
    );
    expect(approve.response.status).toBe(200);
    const methods = runtime.calls.map((entry) => entry.method);
    expect(methods.indexOf("thread/resume")).toBeGreaterThan(-1);
    expect(methods.indexOf("thread/resume")).toBeLessThan(methods.indexOf("turn/start"));
    expect(methods.filter((method) => method === "thread/list")).toHaveLength(1);

    const stale = await call(
      request("/sessions/revising_thread:approvePlan", key, { method: "POST", body: "{}" }),
      ["sessions", "revising_thread:approvePlan"],
      env,
      runtime,
    );
    expect(stale.response.status).toBe(409);
    expect(await metadataStore.get("test@admin.com", "revising_thread")).toMatchObject({ approvedPlanTurnId: null });
  });

  it("refuses to switch the shared checkout while another session is running in it", async () => {
    const { env, key } = await fixture();
    const runtime = fakeRuntime([thread({ id: "busy_thread", status: { type: "active", activeFlags: [] } })]);
    const created = await call(
      request("/sessions", key, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: "Build",
          sourceContext: { source: "sources/github/acme/app", githubRepoContext: { startingBranch: "develop" } },
        }),
      }),
      ["sessions"],
      env,
      runtime,
    );
    expect(created.response.status).toBe(409);
    expect(runtime.calls.some((entry) => entry.method === "thread/start")).toBe(false);
  });

  it("lists and gets deterministic activities from real thread items", async () => {
    const { env, key, metadataStore } = await fixture();
    const planThread = thread({
      id: "plan_thread",
      turns: [turn({
        id: "plan_turn",
        items: [
          { type: "userMessage", id: "user-1", clientId: null, content: [{ type: "text", text: "Build it", text_elements: [] }] },
          { type: "plan", id: "plan_item", text: "1. Inspect\n2. Implement" },
          { type: "agentMessage", id: "agent-1", text: "Plan ready", phase: null, memoryCitation: null },
        ],
      })],
    });
    const runtime = fakeRuntime([planThread]);
    await metadataStore.upsert(sessionMetadata("plan_thread", true));
    const listed = await call(
      request("/sessions/plan_thread/activities?pageSize=2", key),
      ["sessions", "plan_thread", "activities"],
      env,
      runtime,
    );
    expect(listed.response.status).toBe(200);
    expect(listed.body.activities).toHaveLength(2);
    expect(typeof listed.body.nextPageToken).toBe("string");
    const first = (listed.body.activities as Array<{ id: string; name: string }>)[0]!;
    const got = await call(
      request(`/sessions/plan_thread/activities/${first.id}`, key),
      ["sessions", "plan_thread", "activities", first.id],
      env,
      runtime,
    );
    expect(got.response.status).toBe(200);
    expect(got.body).toMatchObject({ id: first.id, name: first.name });

    const unsupported = await call(
      request('/sessions/plan_thread/activities?filter=create_time%3E%222026-01-01T00%3A00%3A00Z%22', key),
      ["sessions", "plan_thread", "activities"],
      env,
      runtime,
    );
    expect(unsupported.response.status).toBe(501);
  });

  it("archives, unarchives, and deletes only API-owned sessions", async () => {
    const { env, key, metadataStore } = await fixture();
    const apiThread = thread({ id: "lifecycle_thread" });
    const runtime = fakeRuntime([apiThread]);
    await metadataStore.upsert(sessionMetadata("lifecycle_thread", false));

    const archived = await call(
      request("/sessions/lifecycle_thread:archive", key, { method: "POST", body: "{}" }),
      ["sessions", "lifecycle_thread:archive"],
      env,
      runtime,
    );
    expect(archived.response.status).toBe(200);
    expect(archived.body.archived).toBe(true);
    expect(runtime.archivedThreads.map((entry) => entry.id)).toContain("lifecycle_thread");

    const unarchived = await call(
      request("/sessions/lifecycle_thread:unarchive", key, { method: "POST", body: "{}" }),
      ["sessions", "lifecycle_thread:unarchive"],
      env,
      runtime,
    );
    expect(unarchived.response.status).toBe(200);
    expect(unarchived.body.archived).toBe(false);
    expect(runtime.threads.map((entry) => entry.id)).toContain("lifecycle_thread");

    const deleted = await call(
      request("/sessions/lifecycle_thread", key, { method: "DELETE" }),
      ["sessions", "lifecycle_thread"],
      env,
      runtime,
    );
    expect(deleted.response.status).toBe(200);
    expect(deleted.body).toEqual({});
    expect(runtime.threads.map((entry) => entry.id)).not.toContain("lifecycle_thread");
    expect(await metadataStore.get("test@admin.com", "lifecycle_thread")).toBeNull();
  });
});

function sessionMetadata(threadId: string, requirePlanApproval: boolean): JulesApiSessionMetadata {
  return {
    threadId,
    userId: "test@admin.com",
    sourceId: sourceIdForCwd(process.cwd()),
    prompt: "Prompt",
    title: "Title",
    requirePlanApproval,
    approvedPlanTurnId: null,
    approvedPlanAt: null,
  };
}
