import { describe, expect, it } from "vitest";

import type { Thread } from "../../src/codex/protocol/generated/v2/Thread";
import type { Turn } from "../../src/codex/protocol/generated/v2/Turn";
import type { JulesApiSessionMetadata } from "../jules-session-store";
import {
  buildJulesActivities,
  buildJulesSession,
  buildJulesSessionOutputs,
  buildJulesSources,
  deriveJulesSessionState,
  findJulesSource,
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
  it("uses GitHub resource names and maps them back to local checkout directories", () => {
    const first = sourceIdForCwd("/workspace/app");
    expect(first).toBe(sourceIdForCwd("/workspace/app"));
    expect(first).toMatch(/^app-[a-f0-9]{12}$/);
    expect(sourceIdForCwd("/workspace/other")).not.toBe(first);

    const sourceThreads = [
      thread(),
      thread({ id: "thread-2", gitInfo: { sha: "def", branch: "feature", originUrl: "https://github.com/acme/app" } }),
      thread({
        id: "thread-3",
        cwd: "/workspace/checkout",
        gitInfo: { sha: "def", branch: "feature", originUrl: "https://github.com/acme/app.git" },
      }),
    ];
    const sources = buildJulesSources("/workspace/app", sourceThreads);
    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({
      name: "sources/github/acme/app",
      id: "github/acme/app",
      cwd: "/workspace/app",
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
    expect(findJulesSource("/workspace/app", sourceThreads, "sources/github/acme/app"))
      .toMatchObject({ id: "github/acme/app", cwd: "/workspace/app" });
    expect(findJulesSource("/workspace/app", sourceThreads, "github/acme/app"))
      .toMatchObject({ id: "github/acme/app", cwd: "/workspace/app" });
    expect(findJulesSource("/workspace/app", sourceThreads, `sources/${first}`))
      .toMatchObject({ id: "github/acme/app", cwd: "/workspace/app" });
    expect(findJulesSource("/workspace/app", sourceThreads, sourceIdForCwd("/workspace/checkout")))
      .toMatchObject({ id: "github/acme/app", cwd: "/workspace/app" });
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

  it("emits change sets only from real file changes and successful git commits", () => {
    const fileChangeTurn = turn({
      items: [{
        type: "fileChange",
        id: "change-1",
        status: "completed",
        changes: [{
          path: "src/app.ts",
          kind: { type: "update", move_path: null },
          diff: "--- a/src/app.ts\n+++ b/src/app.ts\n",
        }],
      }],
    });
    const noOutput = buildJulesSessionOutputs(thread(), metadata());
    expect(noOutput).toEqual([]);

    const outputs = buildJulesSessionOutputs(
      thread({ turns: [fileChangeTurn] }),
      metadata({ sourceId: "github/acme/app", initialGitSha: "abc1234" }),
    );
    expect(outputs).toEqual([{
      changeSet: {
        source: "sources/github/acme/app",
        gitPatch: {
          unidiffPatch: "--- a/src/app.ts\n+++ b/src/app.ts",
          baseCommitId: "abc1234",
        },
      },
    }]);

    const commitTurn = turn({
      items: [{
        type: "commandExecution",
        id: "commit-1",
        command: "git commit -m \"Implement feature\"",
        cwd: "/workspace/app",
        processId: null,
        source: "agent",
        status: "completed",
        commandActions: [],
        aggregatedOutput: "[main abc1234] Implement feature\n 1 file changed, 1 insertion(+)",
        exitCode: 0,
        durationMs: 10,
      }],
    });
    expect(buildJulesSessionOutputs(thread({ turns: [commitTurn] }), metadata()))
      .toEqual([{
        changeSet: {
          source: `sources/${sourceIdForCwd("/workspace/app")}`,
          gitPatch: { suggestedCommitMessage: "Implement feature" },
        },
      }]);
    expect(buildJulesSessionOutputs(thread({ turns: [commitTurn] }), metadata({ initialGitSha: "def5678" })))
      .toEqual([{
        changeSet: {
          source: `sources/${sourceIdForCwd("/workspace/app")}`,
          gitPatch: {
            baseCommitId: "def5678",
            suggestedCommitMessage: "Implement feature",
          },
        },
      }]);
  });

  it("emits a pull request only when a successful gh pr create returns a real URL", () => {
    const command = (output: string, status: "completed" | "failed" = "completed") => turn({
      items: [{
        type: "commandExecution",
        id: "pr-1",
        command: "gh pr create --title \"Add feature\" --body \"Description\" --base main --head feature",
        cwd: "/workspace/app",
        processId: null,
        source: "agent",
        status,
        commandActions: [],
        aggregatedOutput: output,
        exitCode: status === "completed" ? 0 : 1,
        durationMs: 10,
      }],
    });
    expect(buildJulesSessionOutputs(
      thread({ turns: [command("https://github.com/acme/app/pull/35\n")] }),
      metadata({ sourceId: "github/acme/app" }),
    )).toEqual([{
      pullRequest: {
        url: "https://github.com/acme/app/pull/35",
        title: "Add feature",
        description: "Description",
        baseRef: "main",
        headRef: "feature",
      },
    }]);
    expect(buildJulesSessionOutputs(
      thread({ turns: [command("https://github.com/acme/app/pull/35\n", "failed")] }),
      metadata({ sourceId: "github/acme/app" }),
    )).toEqual([]);
  });

  it("builds a Jules session from app-server state and API metadata", () => {
    const session = buildJulesSession(
      thread({ turns: [turn()] }),
      metadata({ startingBranch: "main" }),
      false,
      "https://codex.example",
    );
    expect(session).toMatchObject({
      name: "sessions/thread-1",
      id: "thread-1",
      title: "Feature",
      prompt: "Build the feature",
      sourceContext: {
        source: `sources/${sourceIdForCwd("/workspace/app")}`,
        githubRepoContext: { startingBranch: "main" },
      },
      archived: false,
      state: "COMPLETED",
    });
    expect(session.createTime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/);
    expect(session.updateTime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/);
    expect(session).not.toHaveProperty("cwd");
  });

  it("maps a system error without turns to FAILED", () => {
    expect(deriveJulesSessionState(
      thread({ status: { type: "systemError" } }),
      metadata(),
    )).toBe("FAILED");
  });
});
