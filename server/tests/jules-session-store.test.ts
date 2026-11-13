import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { JulesSessionStore, type JulesApiSessionMetadata } from "../jules-session-store";

function metadata(threadId: string, userId: string): JulesApiSessionMetadata {
  return {
    threadId,
    userId,
    sourceId: "project-abc123",
    prompt: "Implement the feature",
    title: "Feature",
    requirePlanApproval: true,
    approvedPlanTurnId: null,
    approvedPlanAt: null,
  };
}

describe("JulesSessionStore", () => {
  it("isolates users, records plan approval, and persists with owner-only permissions", async () => {
    const directory = await mkdtemp(join(tmpdir(), "codex-web-jules-sessions-"));
    const path = join(directory, "api-sessions.json");
    const store = new JulesSessionStore(path);
    await store.upsert(metadata("thread-a", "user-a"));
    await store.upsert(metadata("thread-b", "user-b"));

    expect(await store.list("user-a")).toHaveLength(1);
    expect(await store.get("user-a", "thread-b")).toBeNull();
    await expect(store.approvePlan("user-a", "thread-a", "turn-1", "2026-11-04T10:00:00.000Z"))
      .resolves.toMatchObject({
        approvedPlanTurnId: "turn-1",
        approvedPlanAt: "2026-11-04T10:00:00.000Z",
      });
    expect((await stat(path)).mode & 0o777).toBe(0o600);

    const reloaded = new JulesSessionStore(path);
    expect(await reloaded.get("user-a", "thread-a")).toMatchObject({
      approvedPlanTurnId: "turn-1",
      prompt: "Implement the feature",
    });
  });

  it("does not let one user overwrite another user's thread metadata", async () => {
    const directory = await mkdtemp(join(tmpdir(), "codex-web-jules-sessions-"));
    const store = new JulesSessionStore(join(directory, "api-sessions.json"));
    await store.upsert(metadata("thread-a", "user-a"));
    await expect(store.upsert(metadata("thread-a", "user-b"))).rejects.toThrow("different user");
  });
});
