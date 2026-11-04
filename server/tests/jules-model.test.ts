import { describe, expect, it } from "vitest";

import type { Thread } from "../../src/codex/protocol/generated/v2/Thread";
import type { Turn } from "../../src/codex/protocol/generated/v2/Turn";
import type { JulesApiSessionMetadata } from "../jules-session-store";
import {
  buildJulesActivities,
  buildJulesSession,
  buildJulesSources,
  deriveJulesSessionState,
  parseGitHubRepo,
  sourceIdForCwd,
} from "../jules-model";

function metadata(overrides: Partial<JulesApiSessionMetadata> = {}): JulesApiSessionMetadata {
  return {
    threadId: "thread-1",
    userId: "user-1",
    sourceId: sourceIdForCwd("/workspace/app"),
    prompt: "Build the feature",
    title: "Feature",
    requirePlanApproval: false,
    approvedPlanTurnId: null,
    approvedPlanAt: null,
    ...overrides,
  };
}

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
    id: "thread-1",
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
    cwd: "/workspace/app",
    cliVersion: "1.0.0",
    source: "appServer",
    threadSource: "codex_web_jules_api",
    agentNickname: null,
    agentRole: null,
    gitInfo: { sha: "abc", branch: "main", originUrl: "git@github.com:acme/app.git" },
    name: "Feature",
    turns: [],
    ...overrides,
  };
}

describe("Jules model mapping", () => {
  it("builds stable source ids without exposing filesystem paths in the API resource", () => {
    const first = sourceIdForCwd("/workspace/app");
    expect(first).toBe(sourceIdForCwd("/workspace/app"));
    expect(first).toMatch(/^app-[a-f0-9]{12}$/);
    expect(sourceIdForCwd("/workspace/other")).not.toBe(first);

    const sources = buildJulesSources("/workspace/app", [
      thread(),
      thread({ id: "thread-2", gitInfo: { sha: "def", branch: "feature", originUrl: "https://github.com/acme/app" } }),
    ]);
    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({
      id: first,
      githubRepo: {
        owner: "acme",
        repo: "app",
        defaultBranch: { displayName: "main" },
      },
    });
    expect(sources[0]!.githubRepo!.branches).toEqual([
      { displayName: "main" },
      { displayName: "feature" },
    ]);
  });

  it("parses GitHub SSH and HTTPS origins", () => {
    expect(parseGitHubRepo("git@github.com:acme/app.git")).toEqual({ owner: "acme", repo: "app" });
    expect(parseGitHubRepo("https://github.com/acme/app.git")).toEqual({ owner: "acme", repo: "app" });
    expect(parseGitHubRepo("https://gitlab.com/acme/app.git")).toBeNull();
  });

  it("only reports AWAITING_PLAN_APPROVAL when a real plan is pending", () => {
    const planTurn = turn({
      items: [{ type: "plan", id: "plan-1", text: "1. Inspect\n2. Implement" }],
    });
    const waitingThread = thread({ turns: [planTurn] });
    expect(deriveJulesSessionState(waitingThread, metadata({ requirePlanApproval: true })))
      .toBe("AWAITING_PLAN_APPROVAL");
    expect(deriveJulesSessionState(waitingThread, metadata({
      requirePlanApproval: true,
      approvedPlanTurnId: "turn-1",
    }))).toBe("COMPLETED");
    expect(deriveJulesSessionState(waitingThread, metadata({ requirePlanApproval: false })))
      .toBe("COMPLETED");
    expect(deriveJulesSessionState(thread({ turns: [turn({ status: "inProgress" })] }), metadata()))
      .toBe("IN_PROGRESS");
    expect(deriveJulesSessionState(thread({ turns: [turn({ status: "failed" })] }), metadata()))
      .toBe("FAILED");
    expect(deriveJulesSessionState(thread({ turns: [turn({ status: "interrupted" })] }), metadata()))
      .toBe("PAUSED");
  });

  it("maps app-server items to deterministic Jules activities", () => {
    const completedTurn = turn({
      id: "turn-plan",
      items: [
        { type: "userMessage", id: "user-1", clientId: null, content: [{ type: "text", text: "Build it", text_elements: [] }] },
        { type: "plan", id: "plan-1", text: "- Inspect\n- Implement" },
        { type: "agentMessage", id: "agent-1", text: "Plan ready", phase: null, memoryCitation: null },
        {
          type: "commandExecution",
          id: "command-1",
          command: "npm test",
          cwd: "/workspace/app",
          processId: null,
          source: "agent",
          status: "completed",
          commandActions: [],
          aggregatedOutput: "ok",
          exitCode: 0,
          durationMs: 10,
        },
      ],
    });
    const session = metadata({ requirePlanApproval: true });
    const threadValue = thread({ turns: [completedTurn] });
    const activities = buildJulesActivities(threadValue, session);
    expect(activities.map((activity) => Object.keys(activity).find((key) => ![
      "name",
      "id",
      "createTime",
      "originator",
      "artifacts",
      "description",
    ].includes(key)))).toEqual([
      "userMessaged",
      "planGenerated",
      "agentMessaged",
      "progressUpdated",
    ]);
    expect(activities[1]).toMatchObject({
      originator: "agent",
      planGenerated: { plan: { id: "plan-1", steps: [
        { title: "Inspect", index: 0 },
        { title: "Implement", index: 1 },
      ] } },
    });
    expect(activities[3]).toMatchObject({
      progressUpdated: { title: "Ran command", description: "npm test" },
      artifacts: [{ bashOutput: { command: "npm test", output: "ok", exitCode: 0 } }],
    });
    expect(buildJulesActivities(threadValue, session)).toEqual(activities);
  });

  it("builds a Jules session from app-server state and API metadata", () => {
    const session = buildJulesSession(
      thread({ turns: [turn()] }),
      metadata(),
      false,
      "https://codex.example",
    );
    expect(session).toMatchObject({
      name: "sessions/thread-1",
      id: "thread-1",
      title: "Feature",
      prompt: "Build the feature",
      sourceContext: { source: `sources/${sourceIdForCwd("/workspace/app")}` },
      archived: false,
      state: "COMPLETED",
    });
    expect(session).not.toHaveProperty("cwd");
  });
});
