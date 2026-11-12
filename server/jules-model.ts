import { createHash } from "node:crypto";
import { basename } from "node:path";

import type { Thread } from "../src/codex/protocol/generated/v2/Thread";
import type { ThreadItem } from "../src/codex/protocol/generated/v2/ThreadItem";
import type { Turn } from "../src/codex/protocol/generated/v2/Turn";
import type { UserInput } from "../src/codex/protocol/generated/v2/UserInput";
import type { JulesApiSessionMetadata } from "./jules-session-store";

export type JulesSessionState =
  | "QUEUED"
  | "PLANNING"
  | "AWAITING_PLAN_APPROVAL"
  | "AWAITING_USER_FEEDBACK"
  | "IN_PROGRESS"
  | "PAUSED"
  | "FAILED"
  | "COMPLETED";

export type JulesSource = {
  name: string;
  id: string;
  cwd: string;
  aliases?: string[];
  githubRepo?: {
    owner?: string;
    repo?: string;
    branches?: Array<{ displayName: string }>;
    defaultBranch?: { displayName: string };
  };
};

export type JulesPlanInfo = {
  turnId: string;
  turn: Turn;
  item: Extract<ThreadItem, { type: "plan" }>;
};

export type JulesSessionOutput = {
  pullRequest?: {
    baseRef?: string;
    title?: string;
    description?: string;
    url: string;
    headRef?: string;
  };
  changeSet?: {
    source: string;
    gitPatch?: {
      unidiffPatch?: string;
      baseCommitId?: string;
      suggestedCommitMessage?: string;
    };
  };
};

type ActivityRecord = Record<string, unknown> & {
  name: string;
  id: string;
  createTime?: string;
  originator: "user" | "agent" | "system";
};

export function buildJulesSources(defaultCwd: string, threads: Thread[]): JulesSource[] {
  const byCwd = new Map<string, { cwd: string; threads: Thread[] }>();
  addCwd(byCwd, defaultCwd, null);
  for (const thread of threads) addCwd(byCwd, thread.cwd, thread);

  const sources = new Map<string, { source: JulesSource; latestUpdate: number }>();
  for (const { cwd, threads: cwdThreads } of byCwd.values()) {
    const repo = githubRepoFromThreads(cwdThreads);
    const id = repo ? `github/${repo.owner}/${repo.repo}` : sourceIdForCwd(cwd);
    const latestUpdate = cwdThreads.reduce((latest, thread) => Math.max(latest, thread.updatedAt), 0);
    const candidate: JulesSource = {
      name: `sources/${id}`,
      id,
      cwd,
      ...(repo ? { aliases: [sourceIdForCwd(cwd)] } : {}),
      ...(repo ? { githubRepo: repo } : {}),
    };
    const existing = sources.get(id);
    if (!existing) {
      sources.set(id, { source: candidate, latestUpdate });
      continue;
    }
    const candidateIsDefault = cwd === defaultCwd;
    const existingIsDefault = existing.source.cwd === defaultCwd;
    if (candidateIsDefault || (!existingIsDefault && latestUpdate > existing.latestUpdate)) {
      existing.source = {
        ...candidate,
        aliases: mergeAliases(candidate.aliases, existing.source.aliases),
        githubRepo: mergeGithubRepo(candidate.githubRepo, existing.source.githubRepo),
      };
      existing.latestUpdate = latestUpdate;
    } else {
      existing.source.aliases = mergeAliases(existing.source.aliases, candidate.aliases);
      existing.source.githubRepo = mergeGithubRepo(existing.source.githubRepo, candidate.githubRepo);
    }
  }

  return Array.from(sources.values())
    .map(({ source }) => source)
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function findJulesSource(
  defaultCwd: string,
  threads: Thread[],
  sourceName: string,
): JulesSource | null {
  const reference = normalizeSourceReference(sourceName);
  if (!reference) return null;
  const sources = buildJulesSources(defaultCwd, threads);
  const exact = sources.find((source) => source.name === reference || source.id === reference);
  if (exact) return exact;

  const githubReference = parseGitHubSourceReference(reference);
  if (githubReference) {
    return sources.find((source) => {
      const repo = source.githubRepo;
      return repo?.owner?.toLowerCase() === githubReference.owner.toLowerCase()
        && repo.repo?.toLowerCase() === githubReference.repo.toLowerCase();
    }) ?? null;
  }

  return sources.find((source) => {
    const localId = sourceIdForCwd(source.cwd);
    return reference === localId || source.aliases?.includes(reference);
  }) ?? null;
}

export function normalizeSourceReference(sourceName: string): string {
  return sourceName.trim().replace(/^\/+|\/+$/g, "").replace(/^sources\//, "");
}

export function parseGitHubSourceReference(reference: string): { owner: string; repo: string } | null {
  const normalized = normalizeSourceReference(reference).replace(/^github\//, "");
  const match = /^([^/]+)\/([^/]+?)(?:\.git)?$/.exec(normalized);
  if (!match) return null;
  return { owner: match[1]!, repo: match[2]! };
}

export function sourceIdForCwd(cwd: string): string {
  const slug = basename(cwd)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32) || "workspace";
  const digest = createHash("sha256").update(cwd).digest("hex").slice(0, 12);
  return `${slug}-${digest}`;
}

export function buildJulesSession(
  thread: Thread,
  metadata: JulesApiSessionMetadata,
  archived: boolean,
  webOrigin: string,
): Record<string, unknown> {
  const outputs = buildJulesSessionOutputs(thread, metadata);
  return {
    name: `sessions/${thread.id}`,
    id: thread.id,
    title: sessionTitle(thread, metadata),
    prompt: metadata.prompt,
    sourceContext: {
      source: `sources/${metadata.sourceId}`,
      ...(metadata.startingBranch
        ? { githubRepoContext: { startingBranch: metadata.startingBranch } }
        : {}),
    },
    requirePlanApproval: metadata.requirePlanApproval,
    archived,
    state: deriveJulesSessionState(thread, metadata),
    createTime: unixSecondsToRfc3339(thread.createdAt),
    updateTime: unixSecondsToRfc3339(thread.updatedAt),
    url: new URL(`/chat/${encodeURIComponent(thread.id)}`, webOrigin).toString(),
    ...(outputs.length > 0 ? { outputs } : {}),
  };
}

export function deriveJulesSessionState(
  thread: Thread,
  metadata: JulesApiSessionMetadata,
): JulesSessionState {
  if (thread.status.type === "systemError") return "FAILED";
  const latestTurn = thread.turns[thread.turns.length - 1];
  if (!latestTurn) {
    return thread.status.type === "active" ? "IN_PROGRESS" : "QUEUED";
  }
  if (thread.status.type === "active" && thread.status.activeFlags.length > 0) return "AWAITING_USER_FEEDBACK";
  if (latestTurn.status === "inProgress") return "IN_PROGRESS";
  if (latestTurn.status === "failed") return "FAILED";
  if (latestTurn.status === "interrupted") return "PAUSED";

  const pendingPlan = findPendingPlan(thread, metadata);
  if (pendingPlan) return "AWAITING_PLAN_APPROVAL";
  return "COMPLETED";
}

export function findPendingPlan(
  thread: Thread,
  metadata: JulesApiSessionMetadata,
): JulesPlanInfo | null {
  if (!metadata.requirePlanApproval) return null;
  const plans = collectPlanItems(thread);
  const latest = plans[plans.length - 1];
  if (!latest) return null;
  if (metadata.approvedPlanTurnId === latest.turnId) return null;
  return latest;
}

export function buildJulesActivities(
  thread: Thread,
  metadata: JulesApiSessionMetadata,
): ActivityRecord[] {
  const activities: ActivityRecord[] = [];
  const orderedTurns = [...thread.turns].sort(
    (left, right) => (left.startedAt ?? 0) - (right.startedAt ?? 0),
  );
  const latestTurn = orderedTurns[orderedTurns.length - 1] ?? null;

  for (const turn of orderedTurns) {
    const createTime = unixSecondsToRfc3339(turn.startedAt) ?? unixSecondsToRfc3339(thread.createdAt);
    for (const item of turn.items) {
      const activity = activityForItem(thread.id, metadata.sourceId, turn, item, createTime);
      if (activity) activities.push(activity);
      if (item.type === "plan" && metadata.approvedPlanTurnId === turn.id) {
        activities.push(activityRecord(
          thread.id,
          `plan-approved:${turn.id}:${item.id}`,
          metadata.approvedPlanAt ?? createTime,
          "user",
          { planApproved: { planId: item.id } },
        ));
      }
    }
  }

  if (latestTurn?.status === "failed") {
    activities.push(activityRecord(
      thread.id,
      `session-failed:${latestTurn.id}`,
      unixSecondsToRfc3339(latestTurn.completedAt ?? latestTurn.startedAt)
        ?? unixSecondsToRfc3339(thread.updatedAt),
      "system",
      { sessionFailed: { reason: latestTurn.error?.message ?? "Codex turn failed" } },
    ));
  } else if (latestTurn?.status === "completed" && !findPendingPlan(thread, metadata)) {
    activities.push(activityRecord(
      thread.id,
      `session-completed:${latestTurn.id}`,
      unixSecondsToRfc3339(latestTurn.completedAt ?? latestTurn.startedAt)
        ?? unixSecondsToRfc3339(thread.updatedAt),
      "system",
      { sessionCompleted: {} },
    ));
  }

  const insertionOrder = new Map(activities.map((activity, index) => [activity.id, index]));
  return activities.sort((left, right) => {
    const timeCompare = (left.createTime ?? "").localeCompare(right.createTime ?? "");
    return timeCompare || (insertionOrder.get(left.id) ?? 0) - (insertionOrder.get(right.id) ?? 0);
  });
}

export function buildJulesSessionOutputs(
  thread: Thread,
  metadata: JulesApiSessionMetadata,
): JulesSessionOutput[] {
  const pullRequests = new Map<string, NonNullable<JulesSessionOutput["pullRequest"]>>();
  const patchParts = new Set<string>();
  let commitDetected = false;
  let suggestedCommitMessage: string | undefined;

  const orderedTurns = [...thread.turns].sort(
    (left, right) => (left.startedAt ?? 0) - (right.startedAt ?? 0),
  );
  for (const turn of orderedTurns) {
    for (const item of turn.items) {
      if (item.type === "commandExecution" && isSuccessfulCommand(item)) {
        const output = item.aggregatedOutput ?? "";
        if (isPullRequestCreateCommand(item.command)) {
          for (const url of githubPullRequestUrls(output)) {
            if (pullRequests.has(url)) continue;
            const pullRequest: NonNullable<JulesSessionOutput["pullRequest"]> = { url };
            const title = commandOption(item.command, "title") ?? commandOption(item.command, "t");
            const description = commandOption(item.command, "body") ?? commandOption(item.command, "b");
            const baseRef = commandOption(item.command, "base") ?? commandOption(item.command, "B");
            const headRef = commandOption(item.command, "head") ?? commandOption(item.command, "H");
            if (title) pullRequest.title = title;
            if (description) pullRequest.description = description;
            if (baseRef) pullRequest.baseRef = baseRef;
            if (headRef) pullRequest.headRef = headRef;
            pullRequests.set(url, pullRequest);
          }
        }
        if (isGitHistoryCommand(item.command) && !isDryRunGitCommand(item.command)) {
          commitDetected = true;
          const summary = commitSummary(output);
          if (summary?.message) suggestedCommitMessage = summary.message;
        }
      }
      if (item.type === "fileChange" && item.status !== "failed" && item.status !== "declined") {
        for (const change of item.changes) {
          if (change.diff.trim()) patchParts.add(change.diff.trim());
        }
      }
    }
  }

  if (metadata.initialGitSha && thread.gitInfo?.sha && thread.gitInfo.sha !== metadata.initialGitSha) {
    commitDetected = true;
  }

  if (pullRequests.size > 0) {
    return Array.from(pullRequests.values()).map((pullRequest) => ({ pullRequest }));
  }

  const unidiffPatch = Array.from(patchParts).join("\n");
  if (!commitDetected && !unidiffPatch) return [];

  const gitPatch: NonNullable<NonNullable<JulesSessionOutput["changeSet"]>["gitPatch"]> = {
    ...(unidiffPatch ? { unidiffPatch } : {}),
    ...(metadata.initialGitSha ? { baseCommitId: metadata.initialGitSha } : {}),
    ...(suggestedCommitMessage ? { suggestedCommitMessage } : {}),
  };
  return [{
    changeSet: {
      source: `sources/${metadata.sourceId}`,
      ...(Object.keys(gitPatch).length > 0 ? { gitPatch } : {}),
    },
  }];
}

export function planFromText(item: Extract<ThreadItem, { type: "plan" }>): Record<string, unknown> {
  const descriptions = item.text
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^(?:[-*+]|\d+[.)])\s+/, "").trim())
    .filter(Boolean);
  const steps = descriptions.length > 0 ? descriptions : [item.text.trim()].filter(Boolean);
  return {
    id: item.id,
    steps: steps.map((description, index) => ({
      id: `${item.id}-${index}`,
      title: description,
      description,
      index,
    })),
  };
}

function activityForItem(
  threadId: string,
  sourceId: string,
  turn: Turn,
  item: ThreadItem,
  createTime: string | undefined,
): ActivityRecord | null {
  const unique = `${turn.id}:${item.id}`;
  if (item.type === "userMessage") {
    const prompt = textFromUserInput(item.content);
    return prompt
      ? activityRecord(threadId, unique, createTime, "user", { userMessaged: { userMessage: prompt } })
      : null;
  }
  if (item.type === "agentMessage") {
    return item.text.trim()
      ? activityRecord(threadId, unique, createTime, "agent", { agentMessaged: { agentMessage: item.text } })
      : null;
  }
  if (item.type === "plan") {
    return activityRecord(threadId, unique, createTime, "agent", {
      planGenerated: { plan: planFromText(item) },
    });
  }
  if (item.type === "commandExecution") {
    const artifacts: Array<Record<string, unknown>> = [{
      bashOutput: {
        command: item.command,
        ...(item.aggregatedOutput === null ? {} : { output: item.aggregatedOutput }),
        ...(item.exitCode === null ? {} : { exitCode: item.exitCode }),
      },
    }];
    return activityRecord(threadId, unique, createTime, "agent", {
      progressUpdated: {
        title: item.status === "completed" ? "Ran command" : `Command ${item.status}`,
        description: item.command,
      },
      artifacts,
    });
  }
  if (item.type === "fileChange") {
    const patch = item.changes.map((change) => change.diff).filter(Boolean).join("\n");
    const artifacts: Array<Record<string, unknown>> = [{
      changeSet: {
        source: `sources/${sourceId}`,
        ...(patch ? { gitPatch: { unidiffPatch: patch } } : {}),
      },
    }];
    return activityRecord(threadId, unique, createTime, "agent", {
      progressUpdated: {
        title: "Updated files",
        description: item.changes.map((change) => change.path).join("\n"),
      },
      artifacts,
    });
  }
  if (item.type === "mcpToolCall") {
    return activityRecord(threadId, unique, createTime, "agent", {
      progressUpdated: {
        title: `${item.server}.${item.tool}`,
        description: `MCP tool ${item.status}`,
      },
    });
  }
  if (item.type === "dynamicToolCall") {
    return activityRecord(threadId, unique, createTime, "agent", {
      progressUpdated: {
        title: item.tool,
        description: `Tool call ${item.status}`,
      },
    });
  }
  if (item.type === "webSearch") {
    return activityRecord(threadId, unique, createTime, "agent", {
      progressUpdated: { title: "Searched the web", description: item.query },
    });
  }
  if (item.type === "imageGeneration") {
    return activityRecord(threadId, unique, createTime, "agent", {
      progressUpdated: { title: "Generated an image", description: item.revisedPrompt ?? item.status },
    });
  }
  return null;
}

function activityRecord(
  threadId: string,
  unique: string,
  createTime: string | undefined,
  originator: ActivityRecord["originator"],
  fields: Record<string, unknown>,
): ActivityRecord {
  const id = createHash("sha256").update(`${threadId}\0${unique}`).digest("hex").slice(0, 32);
  return {
    name: `sessions/${threadId}/activities/${id}`,
    id,
    ...(createTime ? { createTime } : {}),
    originator,
    ...fields,
  };
}

function collectPlanItems(thread: Thread): JulesPlanInfo[] {
  const plans: JulesPlanInfo[] = [];
  for (const turn of thread.turns) {
    for (const item of turn.items) {
      if (item.type === "plan" && item.text.trim()) plans.push({ turnId: turn.id, turn, item });
    }
  }
  return plans;
}

function addCwd(
  byCwd: Map<string, { cwd: string; threads: Thread[] }>,
  cwd: string,
  thread: Thread | null,
): void {
  if (!cwd) return;
  const entry = byCwd.get(cwd) ?? { cwd, threads: [] };
  if (thread) entry.threads.push(thread);
  byCwd.set(cwd, entry);
}

function githubRepoFromThreads(threads: Thread[]): JulesSource["githubRepo"] | undefined {
  let parsed: { owner: string; repo: string } | null = null;
  const branches = new Set<string>();
  for (const thread of threads) {
    if (!parsed && thread.gitInfo?.originUrl) parsed = parseGitHubRepo(thread.gitInfo.originUrl);
    const branch = thread.gitInfo?.branch?.trim();
    if (branch) branches.add(branch);
  }
  if (!parsed) return undefined;
  const branchList = Array.from(branches).map((displayName) => ({ displayName }));
  return {
    owner: parsed.owner,
    repo: parsed.repo,
    ...(branchList.length > 0 ? { branches: branchList, defaultBranch: branchList[0] } : {}),
  };
}

function mergeGithubRepo(
  left: JulesSource["githubRepo"] | undefined,
  right: JulesSource["githubRepo"] | undefined,
): JulesSource["githubRepo"] | undefined {
  if (!left) return right;
  if (!right) return left;
  const branches = new Map<string, { displayName: string }>();
  for (const branch of [...(left.branches ?? []), ...(right.branches ?? [])]) {
    if (branch.displayName) branches.set(branch.displayName, branch);
  }
  const defaultBranch = left.defaultBranch ?? right.defaultBranch;
  return {
    owner: left.owner ?? right.owner,
    repo: left.repo ?? right.repo,
    ...(branches.size > 0 ? { branches: Array.from(branches.values()) } : {}),
    ...(defaultBranch ? { defaultBranch } : {}),
  };
}

function mergeAliases(left: string[] | undefined, right: string[] | undefined): string[] | undefined {
  const aliases = Array.from(new Set([...(left ?? []), ...(right ?? [])]));
  return aliases.length > 0 ? aliases : undefined;
}

function isSuccessfulCommand(
  item: Extract<ThreadItem, { type: "commandExecution" }>,
): boolean {
  return item.status === "completed" && item.exitCode === 0;
}

function isPullRequestCreateCommand(command: string): boolean {
  return /(?:^|[\s;&|"'/])gh\s+pr\s+create\b/.test(command);
}

function githubPullRequestUrls(output: string): string[] {
  const urls = new Set<string>();
  const pattern = /https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/\d+/g;
  for (const match of output.matchAll(pattern)) urls.add(match[0]);
  return Array.from(urls);
}

function isGitHistoryCommand(command: string): boolean {
  return /(?:^|[\s;&|"'/])git\s+(?:commit|merge|cherry-pick|revert|am|rebase)\b/.test(command);
}

function isDryRunGitCommand(command: string): boolean {
  return /\s--dry-run\b/.test(command);
}

function commitSummary(output: string): { sha: string; message: string | undefined } | null {
  const match = /^\[[^\]]*?\s([0-9a-f]{7,40})\]\s*(.*)$/m.exec(output);
  if (!match) return null;
  const message = match[2]?.trim();
  return { sha: match[1]!, message: message || undefined };
}

function commandOption(command: string, name: string): string | undefined {
  const flag = name.length === 1 ? `-${name}` : `--${name}`;
  const pattern = new RegExp(`(?:^|\\s)${flag}(?:=|\\s+)(?:"([^"]*)"|'([^']*)'|(\\S+))`);
  const match = pattern.exec(command);
  return match ? (match[1] ?? match[2] ?? match[3])?.trim() || undefined : undefined;
}

export function parseGitHubRepo(originUrl: string): { owner: string; repo: string } | null {
  const value = originUrl.trim();
  const ssh = /^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/.exec(value);
  if (ssh) return { owner: ssh[1]!, repo: ssh[2]! };
  try {
    const url = new URL(value);
    if (url.hostname !== "github.com" && url.hostname !== "www.github.com") return null;
    const [owner, repo] = url.pathname.replace(/^\/+/, "").split("/");
    if (!owner || !repo) return null;
    return { owner, repo: repo.replace(/\.git$/, "") };
  } catch {
    return null;
  }
}

function sessionTitle(thread: Thread, metadata: JulesApiSessionMetadata): string {
  return thread.name?.trim() || metadata.title.trim() || thread.preview.trim() || "Codex session";
}

function textFromUserInput(input: UserInput[]): string {
  return input
    .filter((item): item is Extract<UserInput, { type: "text" }> => item.type === "text")
    .map((item) => item.text)
    .join("\n")
    .trim();
}

function unixSecondsToRfc3339(seconds: number | null | undefined): string | undefined {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return undefined;
  const date = new Date(seconds * 1_000);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
}

