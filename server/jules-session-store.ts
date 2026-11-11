import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { turnstileStateDirectory } from "./turnstile-config";

export const JULES_API_THREAD_SOURCE = "codex_web_jules_api";

export type JulesApiSessionMetadata = {
  threadId: string;
  userId: string;
  sourceId: string;
  prompt: string;
  title: string;
  requirePlanApproval: boolean;
  approvedPlanTurnId: string | null;
  approvedPlanAt: string | null;
  automationMode?: "AUTOMATION_MODE_UNSPECIFIED" | "AUTO_CREATE_PR";
  startingBranch?: string | null;
  initialGitSha?: string | null;
};

type JulesSessionFile = {
  version: 1;
  sessions: JulesApiSessionMetadata[];
};

type JulesSessionStoreOptions = {
  expectedOwnerUid?: number;
};

const fileLocks = new Map<string, Promise<unknown>>();

export function julesSessionStatePath(
  env: NodeJS.ProcessEnv | Readonly<Record<string, string | undefined>> = process.env,
  home = homedir(),
): string {
  return join(turnstileStateDirectory(env, home), "api-sessions.json");
}

export class JulesSessionStore {
  constructor(
    private readonly path: string,
    private readonly options: JulesSessionStoreOptions = {},
  ) {}

  async list(userId: string): Promise<JulesApiSessionMetadata[]> {
    const file = await this.readFile();
    return file.sessions
      .filter((session) => session.userId === userId)
      .map(copySession);
  }

  async get(userId: string, threadId: string): Promise<JulesApiSessionMetadata | null> {
    const file = await this.readFile();
    const session = file.sessions.find(
      (candidate) => candidate.userId === userId && candidate.threadId === threadId,
    );
    return session ? copySession(session) : null;
  }

  async upsert(session: JulesApiSessionMetadata): Promise<JulesApiSessionMetadata> {
    assertSession(session);
    return this.withLock(async () => {
      const file = await this.readFile();
      const index = file.sessions.findIndex((candidate) => candidate.threadId === session.threadId);
      const existing = index < 0 ? null : file.sessions[index]!;
      if (existing && existing.userId !== session.userId) {
        throw new Error("API session belongs to a different user");
      }
      const next = copySession(session);
      if (index < 0) file.sessions.push(next);
      else file.sessions[index] = next;
      await this.writeFile(file);
      return copySession(next);
    });
  }

  async approvePlan(
    userId: string,
    threadId: string,
    turnId: string,
    approvedAt: string,
  ): Promise<JulesApiSessionMetadata | null> {
    return this.withLock(async () => {
      const file = await this.readFile();
      const session = file.sessions.find(
        (candidate) => candidate.userId === userId && candidate.threadId === threadId,
      );
      if (!session) return null;
      session.approvedPlanTurnId = turnId;
      session.approvedPlanAt = approvedAt;
      await this.writeFile(file);
      return copySession(session);
    });
  }

  async delete(userId: string, threadId: string): Promise<boolean> {
    return this.withLock(async () => {
      const file = await this.readFile();
      const index = file.sessions.findIndex(
        (candidate) => candidate.userId === userId && candidate.threadId === threadId,
      );
      if (index < 0) return false;
      file.sessions.splice(index, 1);
      await this.writeFile(file);
      return true;
    });
  }

  private async readFile(): Promise<JulesSessionFile> {
    let contents: string;
    try {
      const fileStat = await stat(this.path);
      assertSecurePermissions(fileStat.mode, this.options.expectedOwnerUid, fileStat.uid);
      contents = await readFile(this.path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { version: 1, sessions: [] };
      }
      throw error;
    }
    return parseSessionFile(contents);
  }

  private async writeFile(file: JulesSessionFile): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    const temporaryPath = `${this.path}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(file, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    await rename(temporaryPath, this.path);
    await chmod(this.path, 0o600);
  }

  private async withLock<T>(operation: () => Promise<T>): Promise<T> {
    const previous = fileLocks.get(this.path) ?? Promise.resolve();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queueEntry = previous.catch(() => undefined).then(() => gate);
    fileLocks.set(this.path, queueEntry);
    await previous.catch(() => undefined);
    try {
      return await operation();
    } finally {
      release();
      if (fileLocks.get(this.path) === queueEntry) fileLocks.delete(this.path);
    }
  }
}

function parseSessionFile(contents: string): JulesSessionFile {
  const parsed = JSON.parse(contents) as Partial<JulesSessionFile>;
  if (parsed.version !== 1 || !Array.isArray(parsed.sessions)) {
    throw new Error("Invalid API session store format");
  }
  const sessions = parsed.sessions.map((session, index) => parseSession(session, index));
  const threadIds = new Set<string>();
  for (const session of sessions) {
    if (threadIds.has(session.threadId)) throw new Error("Duplicate thread id in API session store");
    threadIds.add(session.threadId);
  }
  return { version: 1, sessions };
}

function parseSession(value: unknown, index: number): JulesApiSessionMetadata {
  if (!value || typeof value !== "object") {
    throw new Error(`Invalid API session entry at index ${index}`);
  }
  const session = value as Partial<JulesApiSessionMetadata>;
  if (
    typeof session.threadId !== "string"
    || typeof session.userId !== "string"
    || typeof session.sourceId !== "string"
    || typeof session.prompt !== "string"
    || typeof session.title !== "string"
    || typeof session.requirePlanApproval !== "boolean"
    || (session.approvedPlanTurnId !== null && typeof session.approvedPlanTurnId !== "string")
    || (session.approvedPlanAt !== null && typeof session.approvedPlanAt !== "string")
    || (session.automationMode !== undefined
      && session.automationMode !== "AUTOMATION_MODE_UNSPECIFIED"
      && session.automationMode !== "AUTO_CREATE_PR")
    || (session.startingBranch !== undefined
      && session.startingBranch !== null
      && typeof session.startingBranch !== "string")
    || (session.initialGitSha !== undefined
      && session.initialGitSha !== null
      && typeof session.initialGitSha !== "string")
  ) {
    throw new Error(`Invalid API session entry at index ${index}`);
  }
  return copySession(session as JulesApiSessionMetadata);
}

function assertSession(session: JulesApiSessionMetadata): void {
  if (!session.threadId || !session.userId || !session.sourceId) {
    throw new Error("API session identifiers are required");
  }
  if (session.prompt.length === 0) throw new Error("API session prompt is required");
}

function copySession(session: JulesApiSessionMetadata): JulesApiSessionMetadata {
  return {
    threadId: session.threadId,
    userId: session.userId,
    sourceId: session.sourceId,
    prompt: session.prompt,
    title: session.title,
    requirePlanApproval: session.requirePlanApproval,
    approvedPlanTurnId: session.approvedPlanTurnId,
    approvedPlanAt: session.approvedPlanAt,
    ...(session.automationMode ? { automationMode: session.automationMode } : {}),
    ...(session.startingBranch !== undefined ? { startingBranch: session.startingBranch } : {}),
    ...(session.initialGitSha !== undefined ? { initialGitSha: session.initialGitSha } : {}),
  };
}

function assertSecurePermissions(mode: number, expectedOwnerUid: number | undefined, ownerUid: number): void {
  if ((mode & 0o077) !== 0) throw new Error("API session store must have 0600 permissions");
  if (expectedOwnerUid !== undefined && ownerUid !== expectedOwnerUid) {
    throw new Error("API session store owner does not match the expected user");
  }
}
