import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";

import type { Thread } from "../src/codex/protocol/generated/v2/Thread";
import type { CommandExecResponse } from "../src/codex/protocol/generated/v2/CommandExecResponse";
import type { ThreadReadResponse } from "../src/codex/protocol/generated/v2/ThreadReadResponse";
import type { ThreadStartResponse } from "../src/codex/protocol/generated/v2/ThreadStartResponse";
import type { ThreadListResponse } from "../src/codex/protocol/generated/v2/ThreadListResponse";
import type { Turn } from "../src/codex/protocol/generated/v2/Turn";
import type { TurnStartResponse } from "../src/codex/protocol/generated/v2/TurnStartResponse";
import type { TurnSteerResponse } from "../src/codex/protocol/generated/v2/TurnSteerResponse";
import { ApiKeyStore, apiKeyStatePath, type ApiKeyPermissionProfile } from "./api-key-store";
import {
  JULES_API_THREAD_SOURCE,
  JulesSessionStore,
  julesSessionStatePath,
  type JulesApiSessionMetadata,
} from "./jules-session-store";
import {
  buildJulesActivities,
  buildJulesSession,
  buildJulesSources,
  deriveJulesSessionState,
  findJulesSource,
  findPendingPlan,
  sourceIdForCwd,
  type JulesSource,
} from "./jules-model";
import {
  createJulesRuntime,
  type JulesApiIdentity,
  type JulesRuntime,
  type JulesRuntimeFactory,
} from "./jules-runtime";
import { BrokerClientError, RuntimeBrokerClient } from "./runtime-broker-client";
import type { BrokerPublicUser } from "./runtime-broker-protocol";
import {
  isBrokerUserAllowedByCurrentWebAuth,
  readWebAuthBinding,
  runtimeBrokerSocket,
  webAuthCredentialVersion,
} from "./web-auth";
import { isEmailAllowedBySsoConfig, readSsoConfigSync } from "./sso-config";

type JulesApiErrorStatus =
  | "INVALID_ARGUMENT"
  | "UNAUTHENTICATED"
  | "PERMISSION_DENIED"
  | "NOT_FOUND"
  | "FAILED_PRECONDITION"
  | "RESOURCE_EXHAUSTED"
  | "UNIMPLEMENTED"
  | "UNAVAILABLE"
  | "INTERNAL";

type JulesApiOptions = {
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  runtimeFactory?: JulesRuntimeFactory;
  now?: () => Date;
};

type JulesMetadataRepository = {
  list: () => Promise<JulesApiSessionMetadata[]>;
  get: (threadId: string) => Promise<JulesApiSessionMetadata | null>;
  upsert: (session: JulesApiSessionMetadata) => Promise<JulesApiSessionMetadata>;
  approve: (threadId: string, turnId: string, approvedAt: string) => Promise<JulesApiSessionMetadata | null>;
  delete: (threadId: string) => Promise<boolean>;
};

type JulesAuthContext = {
  identity: JulesApiIdentity;
  repository: JulesMetadataRepository;
};

const MAX_BODY_BYTES = 1_048_576;
const MAX_THREAD_PAGES = 20;
const THREAD_PAGE_SIZE = 100;
const WORKTREES_DIRECTORY = ".jules-worktrees";

class JulesApiError extends Error {
  constructor(
    readonly statusCode: number,
    readonly status: JulesApiErrorStatus,
    message: string,
  ) {
    super(message);
    this.name = "JulesApiError";
  }
}

export async function handleJulesApi(
  request: Request,
  path: string[],
  options: JulesApiOptions = {},
): Promise<Response> {
  const env = options.env ?? process.env;
  const now = options.now ?? (() => new Date());
  const runtimeFactory = options.runtimeFactory ?? createJulesRuntime;
  try {
    assertSameOrigin(request);
    const apiKey = readApiKey(request);
    const auth = await authenticateApiKey(apiKey, env);
    const route = parseRoute(path);

    if (request.method === "OPTIONS") {
      throw new JulesApiError(405, "INVALID_ARGUMENT", "CORS preflight is not supported");
    }

    const runtime = await runtimeFactory(request, auth.identity);
    try {
      return await dispatchJulesRequest(request, route, runtime, auth, now);
    } finally {
      runtime.close();
    }
  } catch (error) {
    return errorResponse(error);
  }
}

async function dispatchJulesRequest(
  request: Request,
  route: ParsedRoute,
  runtime: JulesRuntime,
  auth: JulesAuthContext,
  now: () => Date,
): Promise<Response> {
  if (route.kind === "sources-list" && request.method === "GET") {
    const query = parsePagination(request, 30);
    const nameFilter = parseSourceNameFilter(new URL(request.url).searchParams.get("filter"));
    const threads = await listThreadsForSources(runtime);
    const sources = buildJulesSources(auth.identity.user.cwd, threads)
      .filter((source) => nameFilter ? nameFilter.has(source.name) || nameFilter.has(source.id) : true)
      .map(publicSource);
    const page = paginate(sources, query.pageSize, query.pageToken, "source");
    return jsonResponse({
      sources: page.items,
      ...(page.nextPageToken ? { nextPageToken: page.nextPageToken } : {}),
    });
  }

  if (route.kind === "source-get" && request.method === "GET") {
    const threads = await listThreadsForSources(runtime);
    const source = findJulesSource(auth.identity.user.cwd, threads, route.sourceName);
    if (!source) throw new JulesApiError(404, "NOT_FOUND", "Source not found");
    return jsonResponse(publicSource(source));
  }

  if (route.kind === "sessions-create" && request.method === "GET") {
    const query = parsePagination(request, 30);
    const archivedFilter = parseArchivedFilter(new URL(request.url).searchParams.get("filter"));
    const metadata = await auth.repository.list();
    const metadataById = new Map(metadata.map((session) => [session.threadId, session]));
    const threads = await listThreadsByArchive(runtime, archivedFilter);
    const visible = threads
      .filter((entry) => metadataById.has(entry.thread.id) && entry.thread.threadSource === JULES_API_THREAD_SOURCE)
      .sort((left, right) => right.thread.updatedAt - left.thread.updatedAt || right.thread.id.localeCompare(left.thread.id));
    const page = paginate(visible, query.pageSize, query.pageToken, "session");
    const origin = new URL(request.url).origin;
    const sessions = await Promise.all(page.items.map(async (entry) => buildJulesSession(
      await readThread(runtime, entry.thread.id, true),
      metadataById.get(entry.thread.id)!,
      entry.archived,
      origin,
    )));
    return jsonResponse({
      sessions,
      ...(page.nextPageToken ? { nextPageToken: page.nextPageToken } : {}),
    });
  }

  if (route.kind === "sessions-create" && request.method === "POST") {
    const body = await readJsonObject(request);
    return await createSession(runtime, auth, body, request, now);
  }

  if (route.kind === "session-get" && request.method === "GET") {
    const { metadata, thread, archived } = await loadOwnedSession(runtime, auth, route.sessionId);
    return jsonResponse(buildJulesSession(thread, metadata, archived, new URL(request.url).origin));
  }

  if (route.kind === "session-get" && request.method === "DELETE") {
    const { metadata, thread } = await loadOwnedSession(runtime, auth, route.sessionId);
    try {
      await runtime.request("thread/delete", { threadId: metadata.threadId });
    } catch (error) {
      if (!isNotFoundError(error)) throw error;
    }
    if (isSessionWorktree(thread.cwd)) await removeSessionWorktree(runtime, thread.cwd).catch(() => undefined);
    await auth.repository.delete(metadata.threadId);
    return jsonResponse({});
  }

  if (route.kind === "session-action" && request.method === "POST") {
    if (route.action === "archive" || route.action === "unarchive") {
      await assertEmptyJsonBody(request);
      const { metadata } = await loadOwnedSession(runtime, auth, route.sessionId);
      await runtime.request(route.action === "archive" ? "thread/archive" : "thread/unarchive", {
        threadId: metadata.threadId,
      });
      const thread = await readThread(runtime, metadata.threadId, true);
      return jsonResponse(buildJulesSession(
        thread,
        metadata,
        route.action === "archive",
        new URL(request.url).origin,
      ));
    }
    if (route.action === "sendMessage") {
      return await sendMessage(runtime, auth, route.sessionId, await readJsonObject(request));
    }
    if (route.action === "approvePlan") {
      await assertEmptyJsonBody(request);
      return await approvePlan(runtime, auth, route.sessionId, now);
    }
  }

  if (route.kind === "activities-list" && request.method === "GET") {
    const query = parsePagination(request, 50);
    assertSupportedActivityFilter(new URL(request.url).searchParams.get("filter"));
    const { thread, metadata } = await loadOwnedSession(runtime, auth, route.sessionId);
    const page = paginate(
      buildJulesActivities(thread, metadata),
      query.pageSize,
      query.pageToken,
      "activity",
    );
    return jsonResponse({
      activities: page.items,
      ...(page.nextPageToken ? { nextPageToken: page.nextPageToken } : {}),
    });
  }

  if (route.kind === "activity-get" && request.method === "GET") {
    const { thread, metadata } = await loadOwnedSession(runtime, auth, route.sessionId);
    const activity = buildJulesActivities(thread, metadata)
      .find((candidate) => candidate.id === route.activityId);
    if (!activity) throw new JulesApiError(404, "NOT_FOUND", "Activity not found");
    return jsonResponse(activity);
  }

  const allowed = allowedMethods(route);
  if (allowed.length === 0) throw new JulesApiError(404, "NOT_FOUND", "Unknown Jules API method");
  throw new JulesApiError(
    405,
    "INVALID_ARGUMENT",
    `Method ${request.method} is not allowed; expected ${allowed.join(", ")}`,
  );
}

async function createSession(
  runtime: JulesRuntime,
  auth: JulesAuthContext,
  body: Record<string, unknown>,
  request: Request,
  now: () => Date,
): Promise<Response> {
  assertOnlyFields(body, ["prompt", "title", "requirePlanApproval", "sourceContext", "automationMode"], "session");
  const prompt = requiredString(body.prompt, "prompt", 100_000);
  const title = optionalString(body.title, "title", 200) ?? "";
  const requirePlanApproval = body.requirePlanApproval === undefined
    ? false
    : requiredBoolean(body.requirePlanApproval, "requirePlanApproval");
  const automationMode = parseAutomationMode(body.automationMode);

  const sourceContext = parseSourceContext(body.sourceContext);
  const allThreads = await listThreadsForSources(runtime);
  const sourceName = sourceContext.source ?? `sources/${sourceIdForCwd(auth.identity.user.cwd)}`;
  const source = findJulesSource(auth.identity.user.cwd, allThreads, sourceName);
  if (!source) throw new JulesApiError(404, "NOT_FOUND", "Source not found");
  const cwd = sourceContext.startingBranch
    ? await createSessionWorktree(runtime, source, sourceContext.startingBranch)
    : source.cwd;
  const instructions = automationInstructions(automationMode, source, sourceContext.startingBranch);

  const threadParams = {
    cwd,
    threadSource: JULES_API_THREAD_SOURCE,
    serviceName: JULES_API_THREAD_SOURCE,
    ...(instructions ? { developerInstructions: instructions } : {}),
    ...threadPermissionOptions(runtime.permissionProfile, cwd),
    collaborationMode: collaborationMode(requirePlanApproval ? "plan" : "default"),
  };
  let started: ThreadStartResponse;
  try {
    started = await runtime.request("thread/start", threadParams) as ThreadStartResponse;
  } catch (error) {
    if (cwd !== source.cwd) await removeSessionWorktree(runtime, cwd).catch(() => undefined);
    throw error;
  }
  const threadId = started.thread.id;
  if (!threadId) throw new Error("thread/start returned no thread id");

  if (title) {
    try {
      await runtime.request("thread/name/set", { threadId, name: title });
    } catch {
      // The title is optional; a naming failure must not orphan a valid thread.
    }
  }

  const metadata: JulesApiSessionMetadata = {
    threadId,
    userId: auth.identity.user.id,
    sourceId: source.id,
    prompt,
    title,
    requirePlanApproval,
    approvedPlanTurnId: null,
    approvedPlanAt: null,
    automationMode,
    startingBranch: sourceContext.startingBranch ?? null,
    initialGitSha: started.thread.gitInfo?.sha ?? null,
  };
  try {
    await auth.repository.upsert(metadata);
  } catch (error) {
    await runtime.request("thread/delete", { threadId }).catch(() => undefined);
    throw error;
  }

  try {
    await runtime.request("turn/start", {
      threadId,
      clientUserMessageId: randomUUID(),
      input: [{ type: "text", text: prompt, text_elements: [] }],
      ...turnPermissionOptions(runtime.permissionProfile, cwd),
      collaborationMode: collaborationMode(requirePlanApproval ? "plan" : "default"),
    });
  } catch (error) {
    await auth.repository.delete(threadId).catch(() => undefined);
    await runtime.request("thread/delete", { threadId }).catch(() => undefined);
    throw error;
  }

  const thread = await readThread(runtime, threadId, true);
  return jsonResponse(buildJulesSession(thread, metadata, false, new URL(request.url).origin));
}

async function sendMessage(
  runtime: JulesRuntime,
  auth: JulesAuthContext,
  sessionId: string,
  body: Record<string, unknown>,
): Promise<Response> {
  assertOnlyFields(body, ["prompt"], "sendMessage");
  const prompt = requiredString(body.prompt, "prompt", 100_000);
  const { thread, metadata, archived } = await loadOwnedSession(runtime, auth, sessionId);
  if (archived) throw new JulesApiError(400, "FAILED_PRECONDITION", "Unarchive the session before sending a message");
  const latestTurn = thread.turns[thread.turns.length - 1];
  if (latestTurn?.status === "inProgress") {
    const result = await runtime.request("turn/steer", {
      threadId: sessionId,
      clientUserMessageId: randomUUID(),
      expectedTurnId: latestTurn.id,
      input: [{ type: "text", text: prompt, text_elements: [] }],
    }) as TurnSteerResponse;
    if (!result.turnId) throw new Error("turn/steer returned no turn id");
    return jsonResponse({});
  }

  const pendingPlan = findPendingPlan(thread, metadata);
  await resumeUnloadedThread(runtime, thread);
  await runtime.request("turn/start", {
    threadId: sessionId,
    clientUserMessageId: randomUUID(),
    input: [{ type: "text", text: prompt, text_elements: [] }],
    ...turnPermissionOptions(runtime.permissionProfile, thread.cwd),
    collaborationMode: collaborationMode(pendingPlan ? "plan" : "default"),
  });
  return jsonResponse({});
}

async function approvePlan(
  runtime: JulesRuntime,
  auth: JulesAuthContext,
  sessionId: string,
  now: () => Date,
): Promise<Response> {
  const { thread, metadata, archived } = await loadOwnedSession(runtime, auth, sessionId);
  if (archived) throw new JulesApiError(400, "FAILED_PRECONDITION", "Unarchive the session before approving a plan");
  const pendingPlan = findPendingPlan(thread, metadata);
  if (!pendingPlan) throw new JulesApiError(409, "FAILED_PRECONDITION", "The session has no plan awaiting approval");
  if (thread.turns[thread.turns.length - 1]?.status !== "completed") {
    throw new JulesApiError(409, "FAILED_PRECONDITION", "The latest turn has not completed; the plan cannot be approved yet");
  }
  await resumeUnloadedThread(runtime, thread);
  const approvedAt = now().toISOString();
  const previous = await auth.repository.approve(sessionId, pendingPlan.turnId, approvedAt);
  if (!previous) throw new JulesApiError(404, "NOT_FOUND", "Session not found");
  try {
    await runtime.request("turn/start", {
      threadId: sessionId,
      clientUserMessageId: randomUUID(),
      input: [{ type: "text", text: "Implement the approved plan.", text_elements: [] }],
      ...turnPermissionOptions(runtime.permissionProfile, thread.cwd),
      collaborationMode: collaborationMode("default"),
    });
  } catch (error) {
    await auth.repository.upsert(metadata).catch(() => undefined);
    throw error;
  }
  return jsonResponse({});
}

async function loadOwnedSession(
  runtime: JulesRuntime,
  auth: JulesAuthContext,
  sessionId: string,
): Promise<{ metadata: JulesApiSessionMetadata; thread: Thread; archived: boolean }> {
  const metadata = await auth.repository.get(sessionId);
  if (!metadata || metadata.userId !== auth.identity.user.id) {
    throw new JulesApiError(404, "NOT_FOUND", "Session not found");
  }
  let thread: Thread;
  try {
    thread = await readThread(runtime, sessionId, true);
  } catch (error) {
    if (isNotFoundError(error)) throw new JulesApiError(404, "NOT_FOUND", "Session not found");
    throw error;
  }
  if (thread.threadSource !== JULES_API_THREAD_SOURCE) {
    throw new JulesApiError(404, "NOT_FOUND", "Session not found");
  }
  const archived = (await listThreads(runtime, true, thread.cwd)).some((candidate) => candidate.id === sessionId);
  return { metadata, thread, archived };
}

// A thread unloaded by an idle runtime shutdown or app-server restart must be resumed before turn/start.
async function resumeUnloadedThread(runtime: JulesRuntime, thread: Thread): Promise<void> {
  if (thread.status.type !== "notLoaded") return;
  await runtime.request("thread/resume", {
    threadId: thread.id,
    ...threadPermissionOptions(runtime.permissionProfile, thread.cwd),
  });
}

async function listThreadsForSources(runtime: JulesRuntime): Promise<Thread[]> {
  const [active, archived] = await Promise.all([
    listThreads(runtime, false),
    listThreads(runtime, true),
  ]);
  const byId = new Map<string, Thread>();
  for (const thread of [...active, ...archived]) {
    if (!isSessionWorktree(thread.cwd)) byId.set(thread.id, thread);
  }
  return Array.from(byId.values());
}

async function listThreadsByArchive(
  runtime: JulesRuntime,
  archived: boolean | "all",
): Promise<Array<{ thread: Thread; archived: boolean }>> {
  if (archived === "all") {
    const [active, archivedThreads] = await Promise.all([
      listThreads(runtime, false),
      listThreads(runtime, true),
    ]);
    return [
      ...active.map((thread) => ({ thread, archived: false })),
      ...archivedThreads.map((thread) => ({ thread, archived: true })),
    ];
  }
  return (await listThreads(runtime, archived)).map((thread) => ({ thread, archived }));
}

async function listThreads(runtime: JulesRuntime, archived: boolean, cwd?: string): Promise<Thread[]> {
  const threads = new Map<string, Thread>();
  let cursor: string | null = null;
  const seenCursors = new Set<string>();
  for (let page = 0; page < MAX_THREAD_PAGES; page += 1) {
    const response = await runtime.request("thread/list", {
      archived,
      sortKey: "updated_at",
      sortDirection: "desc",
      limit: THREAD_PAGE_SIZE,
      ...(cwd === undefined ? {} : { cwd }),
      cursor,
    }) as ThreadListResponse;
    for (const thread of response.data ?? []) threads.set(thread.id, thread);
    const next = response.nextCursor ?? null;
    if (!next || seenCursors.has(next)) break;
    seenCursors.add(next);
    cursor = next;
  }
  return Array.from(threads.values());
}

async function readThread(runtime: JulesRuntime, threadId: string, includeTurns: boolean): Promise<Thread> {
  const response = await runtime.request("thread/read", { threadId, includeTurns }) as ThreadReadResponse;
  if (!response.thread?.id) throw new Error("thread/read returned no thread");
  return response.thread;
}

async function authenticateApiKey(
  apiKey: string,
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
): Promise<JulesAuthContext> {
  let authBinding: string;
  try {
    authBinding = readWebAuthBinding(env);
  } catch {
    throw new JulesApiError(401, "UNAUTHENTICATED", "API key authentication is not configured");
  }
  const brokerSocket = runtimeBrokerSocket(env);
  if (brokerSocket) {
    const client = new RuntimeBrokerClient(brokerSocket);
    try {
      const verified = await client.verifyApiKey(apiKey, authBinding);
      if (!isBrokerUserAllowedByCurrentWebAuth(verified.user, env)) {
        throw new JulesApiError(401, "UNAUTHENTICATED", "API key is invalid or expired");
      }
      return {
        identity: {
          apiKey,
          authBinding,
          user: verified.user,
          permissionProfile: verified.permissionProfile,
        },
        repository: brokerMetadataRepository(client, apiKey, authBinding),
      };
    } catch (error) {
      if (error instanceof JulesApiError) throw error;
      if (error instanceof BrokerClientError && error.code === "unauthorized") {
        throw new JulesApiError(401, "UNAUTHENTICATED", "API key is invalid or expired");
      }
      throw new JulesApiError(503, "UNAVAILABLE", "Runtime broker is unavailable");
    }
  }

  const credentialVersion = webAuthCredentialVersion(env);
  if (!credentialVersion) {
    throw new JulesApiError(401, "UNAUTHENTICATED", "API key authentication is not configured");
  }
  const store = new ApiKeyStore(apiKeyStatePath(env));
  const verification = await store.verify(apiKey, {
    authBinding,
    userCredentialVersion: (userId) => {
      try {
        const sso = readSsoConfigSync(env);
        return !sso.enabled || isEmailAllowedBySsoConfig(userId, sso)
          ? credentialVersion
          : null;
      } catch {
        return null;
      }
    },
  });
  if (!verification || !isSingleUserApiKeyAllowed(verification.userId, env)) {
    throw new JulesApiError(401, "UNAUTHENTICATED", "API key is invalid or expired");
  }
  return {
    identity: {
      apiKey,
      authBinding,
      user: localApiUser(verification.userId, env),
      permissionProfile: verification.permissionProfile,
    },
    repository: singleUserMetadataRepository(new JulesSessionStore(julesSessionStatePath(env)), verification.userId),
  };
}

function brokerMetadataRepository(
  client: RuntimeBrokerClient,
  apiKey: string,
  authBinding: string,
): JulesMetadataRepository {
  return {
    list: () => client.listJulesSessions(apiKey, authBinding),
    get: (threadId) => client.getJulesSession(apiKey, authBinding, threadId),
    upsert: (session) => client.upsertJulesSession(apiKey, authBinding, session),
    approve: (threadId, turnId, approvedAt) =>
      client.approveJulesSessionPlan(apiKey, authBinding, threadId, turnId, approvedAt),
    delete: (threadId) => client.deleteJulesSession(apiKey, authBinding, threadId),
  };
}

function singleUserMetadataRepository(
  store: JulesSessionStore,
  userId: string,
): JulesMetadataRepository {
  return {
    list: () => store.list(userId),
    get: (threadId) => store.get(userId, threadId),
    upsert: (session) => store.upsert(session),
    approve: (threadId, turnId, approvedAt) => store.approvePlan(userId, threadId, turnId, approvedAt),
    delete: (threadId) => store.delete(userId, threadId),
  };
}

function localApiUser(userId: string, env: NodeJS.ProcessEnv | Record<string, string | undefined>): BrokerPublicUser {
  const home = env.CODEX_WEB_HOME_DIRECTORY?.trim() || homedir();
  return {
    id: userId,
    email: userId,
    osUser: env.USER?.trim() || userId,
    home,
    codexHome: env.CODEX_HOME?.trim() || home,
    cwd: process.cwd(),
    role: "admin",
  };
}

function isSingleUserApiKeyAllowed(
  userId: string,
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
): boolean {
  try {
    const sso = readSsoConfigSync(env);
    if (sso.enabled) return isEmailAllowedBySsoConfig(userId, sso);
  } catch {
    return false;
  }
  return userId.trim().toLowerCase() === (env.CODEX_WEB_LOGIN_EMAIL?.trim().toLowerCase() ?? "");
}

function readApiKey(request: Request): string {
  const url = new URL(request.url);
  for (const key of ["key", "apiKey", "api_key", "access_token"]) {
    if (url.searchParams.has(key)) {
      throw new JulesApiError(400, "INVALID_ARGUMENT", "Pass the API key only in the X-Goog-Api-Key header");
    }
  }
  if (request.headers.has("authorization")) {
    throw new JulesApiError(400, "INVALID_ARGUMENT", "Pass the API key only in the X-Goog-Api-Key header");
  }
  const values = request.headers.get("x-goog-api-key")?.trim();
  if (!values || values.includes(",") || values.length > 512) {
    throw new JulesApiError(401, "UNAUTHENTICATED", "Missing or invalid X-Goog-Api-Key header");
  }
  return values;
}

function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (origin) {
    let originUrl: URL;
    try {
      originUrl = new URL(origin);
    } catch {
      throw new JulesApiError(403, "PERMISSION_DENIED", "Invalid request origin");
    }
    const requestHost = request.headers.get("host") ?? new URL(request.url).host;
    if ((originUrl.protocol !== "http:" && originUrl.protocol !== "https:") || originUrl.host !== requestHost) {
      throw new JulesApiError(403, "PERMISSION_DENIED", "Cross-origin Jules API requests are not allowed");
    }
  }
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
    throw new JulesApiError(403, "PERMISSION_DENIED", "Cross-site Jules API requests are not allowed");
  }
}

type ParsedRoute =
  | { kind: "sources-list" }
  | { kind: "source-get"; sourceName: string }
  | { kind: "sessions-list" }
  | { kind: "sessions-create" }
  | { kind: "session-get"; sessionId: string }
  | { kind: "session-action"; sessionId: string; action: "archive" | "unarchive" | "sendMessage" | "approvePlan" }
  | { kind: "activities-list"; sessionId: string }
  | { kind: "activity-get"; sessionId: string; activityId: string };

function parseRoute(path: string[]): ParsedRoute {
  const segments = path.map((segment) => segment.trim()).filter(Boolean);
  if (segments[0] === "sources") {
    if (segments.length === 1) {
      return { kind: "sources-list" };
    }
    if (segments.length === 4 && segments[1] === "github") {
      const owner = segments[2]!;
      const repo = segments[3]!.replace(/\.git$/, "");
      assertGitHubName(owner, "owner");
      assertGitHubName(repo, "repo");
      return { kind: "source-get", sourceName: `sources/github/${owner}/${repo}` };
    }
    if (segments.length === 2) {
      const sourceName = segments[1]!;
      assertResourceId(sourceName.replace(/^sources\//, ""), "source");
      return { kind: "source-get", sourceName: sourceName.startsWith("sources/") ? sourceName : `sources/${sourceName}` };
    }
  }
  if (segments[0] === "sessions") {
    if (segments.length === 1) return { kind: "sessions-create" };
    const sessionSegment = segments[1]!;
    const actionSeparator = sessionSegment.lastIndexOf(":");
    if (segments.length === 2 && actionSeparator > 0) {
      const sessionId = sessionSegment.slice(0, actionSeparator);
      const action = sessionSegment.slice(actionSeparator + 1);
      assertResourceId(sessionId, "session");
      if (action === "archive" || action === "unarchive" || action === "sendMessage" || action === "approvePlan") {
        return { kind: "session-action", sessionId, action };
      }
      throw new JulesApiError(404, "NOT_FOUND", "Unknown session action");
    }
    assertResourceId(sessionSegment, "session");
    if (segments.length === 2) return { kind: "session-get", sessionId: sessionSegment };
    if (segments[2] === "activities") {
      if (segments.length === 3) return { kind: "activities-list", sessionId: sessionSegment };
      if (segments.length === 4) {
        const activityId = segments[3]!;
        assertResourceId(activityId, "activity");
        return { kind: "activity-get", sessionId: sessionSegment, activityId };
      }
    }
  }
  throw new JulesApiError(404, "NOT_FOUND", "Unknown Jules API method");
}

function allowedMethods(route: ParsedRoute): string[] {
  if (route.kind === "sessions-create" || route.kind === "session-action") return ["POST"];
  if (route.kind === "session-get") return ["GET", "DELETE"];
  return ["GET"];
}

function parseSourceNameFilter(filter: string | null): Set<string> | null {
  if (!filter?.trim()) return null;
  if (!filter.includes("name")) {
    throw new JulesApiError(400, "INVALID_ARGUMENT", "Only name filters are supported for sources");
  }
  const names = new Set<string>();
  for (const clause of filter.split(/\s+OR\s+/i)) {
    const match = /^\s*name\s*=\s*(?:"([^"]+)"|'([^']+)'|(\S+))\s*$/i.exec(clause);
    if (!match) throw new JulesApiError(400, "INVALID_ARGUMENT", "Invalid source name filter");
    names.add((match[1] ?? match[2] ?? match[3])!.trim());
  }
  return names;
}

function parseArchivedFilter(filter: string | null): boolean | "all" {
  if (!filter?.trim()) return false;
  const values = new Set<boolean>();
  for (const clause of filter.split(/\s+OR\s+/i)) {
    const match = /^\s*archived\s*=\s*(true|false)\s*$/i.exec(clause);
    if (!match) throw new JulesApiError(400, "INVALID_ARGUMENT", "Only archived filters are supported for sessions");
    values.add(match[1]!.toLowerCase() === "true");
  }
  if (values.size === 2) return "all";
  return values.has(true);
}

function assertSupportedActivityFilter(filter: string | null): void {
  if (!filter?.trim() || filter.trim() === "create_time:*") return;
  throw new JulesApiError(
    501,
    "UNIMPLEMENTED",
    "Only the create_time:* activity filter is supported; time-range filters are not implemented",
  );
}

function parseSourceContext(value: unknown): { source?: string; startingBranch?: string } {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new JulesApiError(400, "INVALID_ARGUMENT", "sourceContext must be an object");
  }
  const context = value as Record<string, unknown>;
  assertOnlyFields(
    context,
    ["source", "githubRepoContext", "workingBranch", "environmentVariablesEnabled"],
    "sourceContext",
  );
  if (context.workingBranch !== undefined && context.workingBranch !== "") {
    throw new JulesApiError(501, "UNIMPLEMENTED", "Working-branch selection is not supported");
  }
  if (context.environmentVariablesEnabled === true) {
    throw new JulesApiError(501, "UNIMPLEMENTED", "Source environment variables are not supported");
  }
  if (context.githubRepoContext !== undefined) {
    if (!context.githubRepoContext || typeof context.githubRepoContext !== "object") {
      throw new JulesApiError(400, "INVALID_ARGUMENT", "githubRepoContext must be an object");
    }
    const repoContext = context.githubRepoContext as Record<string, unknown>;
    assertOnlyFields(repoContext, ["startingBranch"], "githubRepoContext");
  }
  const startingBranch = parseStartingBranch(context.githubRepoContext);
  return {
    ...(context.source === undefined ? {} : { source: requiredString(context.source, "sourceContext.source", 512) }),
    ...(startingBranch ? { startingBranch } : {}),
  };
}

function parseStartingBranch(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new JulesApiError(400, "INVALID_ARGUMENT", "githubRepoContext must be an object");
  }
  const startingBranch = (value as Record<string, unknown>).startingBranch;
  if (startingBranch === undefined || startingBranch === "") return undefined;
  const branch = requiredString(startingBranch, "sourceContext.githubRepoContext.startingBranch", 255);
  if (
    branch.startsWith("-")
    || branch === "HEAD"
    || branch.includes("..")
    || branch.includes("@{")
    || branch.includes("//")
    || branch.endsWith("/")
    || branch.endsWith(".")
    || /[ \t\r\n~^:?*\[\\]/.test(branch)
  ) {
    throw new JulesApiError(400, "INVALID_ARGUMENT", "sourceContext.githubRepoContext.startingBranch is not a valid branch name");
  }
  return branch;
}

function parseAutomationMode(
  value: unknown,
): "AUTOMATION_MODE_UNSPECIFIED" | "AUTO_CREATE_PR" {
  if (value === undefined) return "AUTOMATION_MODE_UNSPECIFIED";
  if (value === "AUTOMATION_MODE_UNSPECIFIED" || value === "AUTO_CREATE_PR") return value;
  throw new JulesApiError(
    400,
    "INVALID_ARGUMENT",
    "automationMode must be AUTO_CREATE_PR or AUTOMATION_MODE_UNSPECIFIED",
  );
}

function automationInstructions(
  mode: "AUTOMATION_MODE_UNSPECIFIED" | "AUTO_CREATE_PR",
  source: JulesSource,
  startingBranch: string | undefined,
): string | undefined {
  if (mode !== "AUTO_CREATE_PR") return undefined;
  const repo = source.githubRepo?.owner && source.githubRepo.repo
    ? `${source.githubRepo.owner}/${source.githubRepo.repo}`
    : "the selected GitHub repository";
  return [
    "Automation mode AUTO_CREATE_PR is enabled for this API session.",
    `If you make code changes for ${repo}, create a dedicated working branch, commit the changes, push the branch, and open a pull request with \`gh pr create\`.`,
    startingBranch ? `Use \`${startingBranch}\` as the pull request base branch.` : "",
    "Only report a pull request URL when a successful command actually returned it.",
    "If git credentials, a GitHub remote, or gh are unavailable, report that the pull request could not be created instead of claiming success.",
  ].filter(Boolean).join("\n");
}

// A session with a starting branch gets its own worktree, so it never switches branches in the
// checkout that people and other sessions are using.
async function createSessionWorktree(
  runtime: JulesRuntime,
  source: JulesSource,
  startingBranch: string,
): Promise<string> {
  const fetched = await runGit(
    runtime,
    source.cwd,
    ["fetch", "origin", `+refs/heads/${startingBranch}:refs/remotes/origin/${startingBranch}`],
    60_000,
  );
  if (fetched.exitCode !== 0) {
    throw new JulesApiError(
      400,
      "FAILED_PRECONDITION",
      `Starting branch ${startingBranch} was not found on origin: ${commandError(fetched)}`,
    );
  }
  const worktree = join(
    dirname(source.cwd),
    WORKTREES_DIRECTORY,
    `${basename(source.cwd)}-${randomUUID().slice(0, 8)}`,
  );
  const added = await runGit(
    runtime,
    source.cwd,
    ["worktree", "add", "--detach", worktree, `origin/${startingBranch}`],
    120_000,
  );
  if (added.exitCode !== 0) {
    throw new JulesApiError(
      400,
      "FAILED_PRECONDITION",
      `Unable to create a worktree for starting branch ${startingBranch}: ${commandError(added)}`,
    );
  }
  return worktree;
}

function isSessionWorktree(cwd: string): boolean {
  return basename(dirname(cwd)) === WORKTREES_DIRECTORY;
}

async function removeSessionWorktree(runtime: JulesRuntime, worktree: string): Promise<void> {
  await runGit(runtime, worktree, ["worktree", "remove", "--force", worktree]);
}

async function runGit(
  runtime: JulesRuntime,
  cwd: string,
  args: string[],
  timeoutMs = 30_000,
): Promise<CommandExecResponse> {
  try {
    return await runtime.request("command/exec", {
      command: ["git", ...args],
      cwd,
      timeoutMs,
      // These fixed git commands (validated branch name) need origin access and a writable .git,
      // which the workspace sandbox denies.
      sandboxPolicy: { type: "dangerFullAccess" },
    }, timeoutMs + 5_000) as CommandExecResponse;
  } catch (error) {
    throw new JulesApiError(
      400,
      "FAILED_PRECONDITION",
      `Unable to run git ${args[0] ?? ""}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function commandError(result: CommandExecResponse): string {
  return (result.stderr.trim() || result.stdout.trim() || `git exited with code ${result.exitCode}`).slice(0, 500);
}

function parsePagination(request: Request, defaultPageSize: number): {
  pageSize: number;
  pageToken: string | null;
} {
  const params = new URL(request.url).searchParams;
  const rawSize = params.get("pageSize");
  let pageSize = defaultPageSize;
  if (rawSize !== null) {
    if (!/^\d+$/.test(rawSize) || Number(rawSize) < 1) {
      throw new JulesApiError(400, "INVALID_ARGUMENT", "pageSize must be an integer between 1 and 100");
    }
    pageSize = Math.min(100, Number(rawSize));
  }
  return { pageSize, pageToken: params.get("pageToken") };
}

function paginate<T>(
  items: T[],
  pageSize: number,
  pageToken: string | null,
  key: string,
): { items: T[]; nextPageToken?: string } {
  const offset = decodePageToken(pageToken);
  if (offset > items.length && offset !== 0) {
    throw new JulesApiError(400, "INVALID_ARGUMENT", "pageToken is invalid");
  }
  const page = items.slice(offset, offset + pageSize);
  const nextOffset = offset + page.length;
  return {
    items: page,
    ...(nextOffset < items.length
      ? { [`nextPageToken`]: encodePageToken(nextOffset, key) }
      : {}),
  };
}

function encodePageToken(offset: number, key: string): string {
  return Buffer.from(JSON.stringify({ offset, key }), "utf8").toString("base64url");
}

function decodePageToken(token: string | null): number {
  if (!token) return 0;
  try {
    const parsed = JSON.parse(Buffer.from(token, "base64url").toString("utf8")) as {
      offset?: unknown;
      key?: unknown;
    };
    if (!Number.isSafeInteger(parsed.offset) || (parsed.offset as number) < 0 || (parsed.offset as number) > 10_000) {
      throw new Error();
    }
    return parsed.offset as number;
  } catch {
    throw new JulesApiError(400, "INVALID_ARGUMENT", "pageToken is invalid");
  }
}

function publicSource(source: JulesSource): Record<string, unknown> {
  return {
    name: source.name,
    id: source.id,
    ...(source.githubRepo ? { githubRepo: source.githubRepo } : {}),
  };
}

function threadPermissionOptions(profile: ApiKeyPermissionProfile, _cwd: string): Record<string, unknown> {
  return profile === "full_access"
    ? { approvalPolicy: "never", approvalsReviewer: "user", sandbox: "danger-full-access" }
    : { approvalPolicy: "on-request", approvalsReviewer: "user", sandbox: "workspace-write" };
}

function turnPermissionOptions(profile: ApiKeyPermissionProfile, cwd: string): Record<string, unknown> {
  return profile === "full_access"
    ? { approvalPolicy: "never", approvalsReviewer: "user", sandboxPolicy: { type: "dangerFullAccess" } }
    : {
        approvalPolicy: "on-request",
        approvalsReviewer: "user",
        sandboxPolicy: sandboxPolicy(profile, cwd),
      };
}

function sandboxPolicy(profile: ApiKeyPermissionProfile, cwd: string): Record<string, unknown> {
  return profile === "full_access"
    ? { type: "dangerFullAccess" }
    : {
        type: "workspaceWrite",
        writableRoots: [cwd],
        networkAccess: false,
        excludeTmpdirEnvVar: false,
        excludeSlashTmp: false,
      };
}

function collaborationMode(mode: "plan" | "default"): Record<string, unknown> {
  return {
    mode,
    settings: {
      model: "",
      reasoning_effort: null,
      developer_instructions: null,
    },
  };
}

async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    throw new JulesApiError(400, "INVALID_ARGUMENT", "Request body is too large");
  }
  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > MAX_BODY_BYTES) {
    throw new JulesApiError(400, "INVALID_ARGUMENT", "Request body is too large");
  }
  if (!text.trim()) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new JulesApiError(400, "INVALID_ARGUMENT", "Request body must be valid JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new JulesApiError(400, "INVALID_ARGUMENT", "Request body must be a JSON object");
  }
  return parsed as Record<string, unknown>;
}

async function assertEmptyJsonBody(request: Request): Promise<void> {
  const body = await readJsonObject(request);
  assertOnlyFields(body, [], "request");
}

function assertOnlyFields(value: Record<string, unknown>, allowed: string[], context: string): void {
  const allowedSet = new Set(allowed);
  const unsupported = Object.keys(value).filter((key) => !allowedSet.has(key));
  if (unsupported.length > 0) {
    throw new JulesApiError(400, "INVALID_ARGUMENT", `Unsupported ${context} field: ${unsupported[0]}`);
  }
}

function requiredString(value: unknown, name: string, maximumLength: number): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new JulesApiError(400, "INVALID_ARGUMENT", `${name} must be a non-empty string`);
  }
  if (value.length > maximumLength) {
    throw new JulesApiError(400, "INVALID_ARGUMENT", `${name} is too long`);
  }
  return value;
}

function optionalString(value: unknown, name: string, maximumLength: number): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new JulesApiError(400, "INVALID_ARGUMENT", `${name} must be a string`);
  if (value.length > maximumLength) throw new JulesApiError(400, "INVALID_ARGUMENT", `${name} is too long`);
  return value;
}

function requiredBoolean(value: unknown, name: string): boolean {
  if (typeof value !== "boolean") {
    throw new JulesApiError(400, "INVALID_ARGUMENT", `${name} must be a boolean`);
  }
  return value;
}

function assertResourceId(value: string, name: string): void {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(value)) {
    throw new JulesApiError(400, "INVALID_ARGUMENT", `Invalid ${name} id`);
  }
}

function assertGitHubName(value: string, name: "owner" | "repo"): void {
  if (!/^[A-Za-z0-9_.-]{1,100}$/.test(value) || value === "." || value === "..") {
    throw new JulesApiError(400, "INVALID_ARGUMENT", `Invalid GitHub ${name}`);
  }
}

function isNotFoundError(error: unknown): boolean {
  return /not found|does not exist|不存在/i.test(error instanceof Error ? error.message : String(error));
}

function errorResponse(error: unknown): Response {
  if (error instanceof JulesApiError) {
    return jsonResponse({
      error: {
        code: error.statusCode,
        message: error.message,
        status: error.status,
      },
    }, error.statusCode);
  }
  const message = error instanceof Error ? error.message : "Jules API request failed";
  return jsonResponse({
    error: {
      code: 503,
      message: message.slice(0, 500),
      status: "UNAVAILABLE",
    },
  }, 503);
}

function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store, max-age=0",
      Pragma: "no-cache",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
