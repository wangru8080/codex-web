import { randomBytes } from "node:crypto";
import { lookup } from "node:dns/promises";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { isIP } from "node:net";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import https from "node:https";

import webpush from "web-push";

import type { JsonRpcId, JsonRpcMessage, JsonRpcRequest, JsonRpcResponse } from "../src/codex/protocol/json-rpc";
import type { RuntimeBrokerUserConfig } from "./runtime-broker-config";
import { turnstileStateDirectory } from "./turnstile-config";
import {
  notificationFromAppServerMessage,
  type CodexPushPayload,
} from "./push-app-server-events";

export const PUSH_REGISTER_METHOD = "codexWeb/push/register";
export const PUSH_UNREGISTER_METHOD = "codexWeb/push/unregister";
export const PUSH_CONFIG_METHOD = "codexWeb/push/config";

type PushEnvironment = Readonly<Record<string, string | undefined>>;

type VapidKeys = {
  publicKey: string;
  privateKey: string;
};

export type PushSubscriptionKeys = {
  p256dh: string;
  auth: string;
};

type PushSubscriptionRecord = {
  userId: string;
  email: string;
  instance: string;
  endpoint: string;
  keys: PushSubscriptionKeys;
  updatedAt: number;
  testDeliveredAt: number | null;
};

type PersistedPushState = {
  version: 1;
  vapid: VapidKeys | null;
  subscriptions: PushSubscriptionRecord[];
};

type PushUser = Pick<RuntimeBrokerUserConfig, "id" | "email">;

type PushTransport = {
  generateVapidKeys: () => VapidKeys;
  send: (
    subscription: { endpoint: string; keys: PushSubscriptionKeys },
    payload: string,
    vapidDetails: { subject: string; publicKey: string; privateKey: string },
  ) => Promise<{ statusCode?: number }>;
};

type PushDeliveryResult = {
  delivered: boolean;
  stale: boolean;
  statusCode?: number;
  error?: string;
};

type PushTestResult = {
  delivered: boolean;
  sent: boolean;
  statusCode?: number;
  error?: string;
};

type PushNotificationServiceOptions = {
  env?: PushEnvironment;
  home?: string;
  statePath?: string;
  transport?: PushTransport;
  now?: () => number;
  logger?: Pick<Console, "warn" | "info">;
};

const MAX_SUBSCRIPTIONS = 20;
const MAX_DEDUPE_KEYS = 512;
const PUSH_CONFIG_FILE = "push.json";
const PUSH_TTL_SECONDS = 86_400;

export function pushStatePath(env: PushEnvironment = process.env, home = homedir()): string {
  return join(turnstileStateDirectory(env, home), PUSH_CONFIG_FILE);
}

export function isPushBridgeMethod(method: string): boolean {
  return method === PUSH_REGISTER_METHOD
    || method === PUSH_UNREGISTER_METHOD
    || method === PUSH_CONFIG_METHOD;
}

export class PushNotificationService {
  private readonly statePath: string;
  private readonly transport: PushTransport;
  private readonly env: PushEnvironment;
  private readonly now: () => number;
  private readonly logger: Pick<Console, "warn" | "info">;
  private readonly vapidSubject: string;
  private readonly allowInsecureEndpoints: boolean;
  private readonly agent = createPublicOnlyHttpsAgent();
  private readonly threadNames = new Map<string, string>();
  private readonly goalStatuses = new Map<string, string>();
  private readonly notified = new Set<string>();
  private writeChain: Promise<void> = Promise.resolve();
  private loading: Promise<PersistedPushState> | null = null;

  constructor(options: PushNotificationServiceOptions = {}) {
    const env = options.env ?? process.env;
    this.env = env;
    this.statePath = options.statePath ?? pushStatePath(env, options.home);
    this.transport = options.transport ?? defaultPushTransport(this.agent);
    this.now = options.now ?? Date.now;
    this.logger = options.logger ?? console;
    this.vapidSubject = env.CODEX_WEB_PUSH_VAPID_SUBJECT?.trim()
      || "https://github.com/wangru8080/codex-web";
    this.allowInsecureEndpoints = env.CODEX_WEB_PUSH_ALLOW_INSECURE_ENDPOINTS === "1";
  }

  get configPath(): string {
    return this.statePath;
  }

  async publicConfig(): Promise<{ vapidPublicKey: string; source: "codex-web.push" }> {
    const state = await this.load();
    const vapid = await this.ensureVapidKeys(state);
    return { vapidPublicKey: vapid.publicKey, source: "codex-web.push" };
  }

  async handleClientRequest(
    user: PushUser,
    message: JsonRpcRequest,
  ): Promise<JsonRpcResponse | null> {
    if (!isPushBridgeMethod(message.method) || message.id === undefined) return null;
    try {
      const result = message.method === PUSH_CONFIG_METHOD
        ? await this.publicConfig()
        : message.method === PUSH_REGISTER_METHOD
          ? await this.registerFromParams(user, message.params)
          : await this.unregisterFromParams(user, message.params);
      return { id: message.id, result };
    } catch (error) {
      return {
        id: message.id,
        error: {
          code: -32602,
          message: error instanceof Error ? error.message : "Invalid push request",
        },
      };
    }
  }

  handleAppServerMessage(user: PushUser, message: JsonRpcMessage): void {
    this.trackThreadMetadata(message);
    const previousGoalStatus = this.trackGoalStatus(message);
    const notification = notificationFromAppServerMessage(message, {
      threadName: notificationThreadId(message)
        ? this.threadNames.get(notificationThreadId(message)!)
        : undefined,
      previousGoalStatus,
      now: this.now(),
    });
    if (!notification || this.notified.has(notification.dedupeKey)) return;
    rememberBounded(this.notified, notification.dedupeKey, MAX_DEDUPE_KEYS);
    void this.deliver(user, notification.payload).catch((error) => {
      this.logger.warn(`[push] delivery failed for ${notification.payload.kind}: ${errorName(error)}`);
    });
  }

  private async registerFromParams(user: PushUser, params: unknown): Promise<Record<string, unknown>> {
    const input = asObject(params);
    if (!input) throw new Error("push registration params must be an object");
    const instance = requiredString(input.instance, "instance", 100);
    const endpoint = validatePushEndpoint(requiredString(input.endpoint, "endpoint", 1000), this.allowInsecureEndpoints);
    const keys = asObject(input.keys);
    const p256dh = requiredString(keys?.p256dh, "keys.p256dh", 200);
    const auth = requiredString(keys?.auth, "keys.auth", 200);
    if (!/^[A-Za-z0-9_-]+={0,2}$/.test(p256dh) || !/^[A-Za-z0-9_-]+={0,2}$/.test(auth)) {
      throw new Error("UnifiedPush endpoint returned invalid Web Push keys");
    }

    const state = await this.load();
    await this.ensureVapidKeys(state);
    const previous = state.subscriptions.find((subscription) =>
      subscription.userId === user.id && subscription.instance === instance,
    );
    const unchanged = previous !== undefined && sameSubscriptionTarget(previous, endpoint, { p256dh, auth });
    const record: PushSubscriptionRecord = {
      userId: user.id,
      email: user.email,
      instance,
      endpoint,
      keys: { p256dh, auth },
      updatedAt: this.now(),
      testDeliveredAt: unchanged ? previous.testDeliveredAt : null,
    };
    state.subscriptions = state.subscriptions.filter((subscription) =>
      !(subscription.userId === user.id && subscription.instance === instance),
    );
    state.subscriptions.push(record);
    if (state.subscriptions.length > MAX_SUBSCRIPTIONS) {
      state.subscriptions = state.subscriptions
        .sort((left, right) => right.updatedAt - left.updatedAt)
        .slice(0, MAX_SUBSCRIPTIONS);
    }
    await this.persist(state);
    const testNotification = unchanged && previous.testDeliveredAt !== null
      ? { delivered: true, sent: false }
      : await this.sendRegistrationTest(record, state);
    if (!testNotification.delivered) {
      this.logger.warn(`[push] registration test delivery failed: ${testNotification.error ?? "unknown error"}`);
    } else if (testNotification.sent) {
      const stored = state.subscriptions.find((subscription) =>
        subscription.userId === user.id && subscription.instance === instance,
      );
      if (stored) {
        stored.testDeliveredAt = this.now();
        await this.persist(state);
      }
    }
    return { registered: true, instance, source: "codex-web.push", testNotification };
  }

  private async unregisterFromParams(user: PushUser, params: unknown): Promise<Record<string, unknown>> {
    const input = asObject(params);
    const instance = requiredString(input?.instance, "instance", 100);
    const state = await this.load();
    const before = state.subscriptions.length;
    state.subscriptions = state.subscriptions.filter((subscription) =>
      !(subscription.userId === user.id && subscription.instance === instance),
    );
    if (state.subscriptions.length !== before) await this.persist(state);
    return { unregistered: true, instance, source: "codex-web.push" };
  }

  private async sendRegistrationTest(
    subscription: PushSubscriptionRecord,
    state: PersistedPushState,
  ): Promise<PushTestResult> {
    const result = await this.sendToSubscription(subscription, {
      version: 1,
      kind: "test",
      title: "Codex Web notifications are working",
      body: "This test notification confirms that Codex Web can reach this device.",
      threadId: null,
      turnId: null,
      requestId: "registration-test",
      source: "codex-web.push.registration_test",
      createdAt: this.now(),
    }, await this.ensureVapidKeys(state));

    if (result.stale) {
      state.subscriptions = state.subscriptions.filter((candidate) =>
        !(candidate.userId === subscription.userId && candidate.instance === subscription.instance),
      );
      await this.persist(state);
    }

    return result.delivered
      ? { delivered: true, sent: true, statusCode: result.statusCode }
      : {
          delivered: false,
          sent: true,
          statusCode: result.statusCode,
          error: result.error ?? "Push delivery failed",
        };
  }

  private async deliver(user: PushUser, payload: CodexPushPayload): Promise<void> {
    const state = await this.load();
    const subscriptions = state.subscriptions.filter((subscription) => subscription.userId === user.id);
    if (subscriptions.length === 0) return;
    const vapid = await this.ensureVapidKeys(state);
    const results = await Promise.all(subscriptions.map(async (subscription) => ({
      subscription,
      result: await this.sendToSubscription(subscription, payload, vapid),
    })));
    const stale = new Set<string>();

    for (const { subscription, result } of results) {
      if (result.stale) {
        stale.add(subscription.instance);
      } else if (!result.delivered) {
        this.logger.warn(`[push] ${payload.kind} delivery failed: ${result.error ?? "unknown error"}`);
      }
    }

    if (stale.size === 0) return;
    state.subscriptions = state.subscriptions.filter((subscription) =>
      !(subscription.userId === user.id && stale.has(subscription.instance)),
    );
    await this.persist(state);
  }

  private async sendToSubscription(
    subscription: PushSubscriptionRecord,
    payload: CodexPushPayload,
    vapid: VapidKeys,
  ): Promise<PushDeliveryResult> {
    try {
      const result = await this.transport.send(
        { endpoint: subscription.endpoint, keys: subscription.keys },
        JSON.stringify(payload),
        { subject: this.vapidSubject, ...vapid },
      );
      const statusCode = result.statusCode;
      if (statusCode === 404 || statusCode === 410) {
        return { delivered: false, stale: true, statusCode, error: `Push service returned HTTP ${statusCode}` };
      }
      if (statusCode !== undefined && (statusCode < 200 || statusCode >= 300)) {
        return { delivered: false, stale: false, statusCode, error: `Push service returned HTTP ${statusCode}` };
      }
      return { delivered: true, stale: false, statusCode };
    } catch (error) {
      const statusCode = errorStatus(error);
      return {
        delivered: false,
        stale: statusCode === 404 || statusCode === 410,
        statusCode,
        error: statusCode === undefined ? errorName(error) : `Push service returned HTTP ${statusCode}`,
      };
    }
  }

  private trackThreadMetadata(message: JsonRpcMessage): void {
    if (!("method" in message)) return;
    const params = asObject(message.params);
    if (!params) return;
    if (message.method === "thread/started") {
      const thread = asObject(params.thread);
      const threadId = readString(thread, "id");
      const name = readString(thread, "name")?.trim();
      if (threadId && name) this.threadNames.set(threadId, name);
      return;
    }
    if (message.method === "thread/name/updated") {
      const threadId = readString(params, "threadId");
      const name = readString(params, "threadName")?.trim();
      if (threadId && name) this.threadNames.set(threadId, name);
    }
  }

  private trackGoalStatus(message: JsonRpcMessage): string | undefined {
    if (!("method" in message)) return undefined;
    const params = asObject(message.params);
    if (!params) return undefined;
    if (message.method === "thread/goal/cleared") {
      const threadId = readString(params, "threadId");
      if (threadId) {
        this.goalStatuses.delete(threadId);
        this.notified.delete(`goal:${threadId}:complete`);
      }
      return undefined;
    }
    if (message.method !== "thread/goal/updated") return undefined;
    const goal = asObject(params.goal);
    const threadId = readString(params, "threadId") ?? readString(goal, "threadId");
    const status = readString(goal, "status");
    if (!threadId || !status) return undefined;
    const previous = this.goalStatuses.get(threadId);
    this.goalStatuses.set(threadId, status);
    if (status !== "complete") this.notified.delete(`goal:${threadId}:complete`);
    return previous;
  }

  private async ensureVapidKeys(state: PersistedPushState): Promise<VapidKeys> {
    if (state.vapid) return state.vapid;
    const publicKey = this.env.CODEX_WEB_PUSH_VAPID_PUBLIC_KEY?.trim();
    const privateKey = this.env.CODEX_WEB_PUSH_VAPID_PRIVATE_KEY?.trim();
    if (Boolean(publicKey) !== Boolean(privateKey)) {
      throw new Error("CODEX_WEB_PUSH_VAPID_PUBLIC_KEY and PRIVATE_KEY must be set together");
    }
    state.vapid = publicKey && privateKey ? { publicKey, privateKey } : this.transport.generateVapidKeys();
    await this.persist(state);
    return state.vapid;
  }

  private load(): Promise<PersistedPushState> {
    if (!this.loading) {
      this.loading = this.readState().catch((error) => {
        this.loading = null;
        throw error;
      });
    }
    return this.loading;
  }

  private async readState(): Promise<PersistedPushState> {
    try {
      const parsed = JSON.parse(await readFile(this.statePath, "utf8")) as Partial<PersistedPushState>;
      return {
        version: 1,
        vapid: parseVapid(parsed.vapid),
        subscriptions: Array.isArray(parsed.subscriptions)
          ? parsed.subscriptions.map(parseSubscription).filter((item): item is PushSubscriptionRecord => item !== null)
          : [],
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      return { version: 1, vapid: null, subscriptions: [] };
    }
  }

  private persist(state: PersistedPushState): Promise<void> {
    const snapshot = `${JSON.stringify(state, null, 2)}\n`;
    const write = this.writeChain.then(async () => {
      await mkdir(dirname(this.statePath), { recursive: true, mode: 0o700 });
      await chmod(dirname(this.statePath), 0o700);
      const temporaryPath = `${this.statePath}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
      await writeFile(temporaryPath, snapshot, { encoding: "utf8", mode: 0o600, flag: "wx" });
      await rename(temporaryPath, this.statePath);
      await chmod(this.statePath, 0o600);
    });
    this.writeChain = write.catch(() => undefined);
    return write;
  }
}

export function pushBridgeErrorResponse(id: JsonRpcId, error: unknown): JsonRpcResponse {
  return {
    id,
    error: {
      code: -32603,
      message: error instanceof Error ? error.message : "Push bridge request failed",
    },
  };
}

function defaultPushTransport(agent: https.Agent): PushTransport {
  return {
    generateVapidKeys: () => webpush.generateVAPIDKeys(),
    send: async (subscription, payload, vapidDetails) => webpush.sendNotification(
      subscription,
      payload,
      {
        agent,
        vapidDetails,
        TTL: PUSH_TTL_SECONDS,
        urgency: "high",
        timeout: 10_000,
      },
    ),
  };
}

export function validatePushEndpoint(endpoint: string, allowInsecure = false): string {
  let parsed: URL;
  try {
    parsed = new URL(endpoint);
  } catch {
    throw new Error("UnifiedPush endpoint is not a valid URL");
  }
  if (parsed.protocol !== "https:" && !(allowInsecure && parsed.protocol === "http:")) {
    throw new Error("UnifiedPush endpoint must use HTTPS");
  }
  if (parsed.username || parsed.password) throw new Error("UnifiedPush endpoint must not contain credentials");
  if (!parsed.hostname || parsed.hash) throw new Error("UnifiedPush endpoint is invalid");
  if (isPrivateHostname(parsed.hostname)) throw new Error("UnifiedPush endpoint must be publicly routable");
  return parsed.toString();
}

export function isPrivateAddress(address: string): boolean {
  const normalized = normalizeIpLiteral(address);
  const family = isIP(normalized);
  if (family === 0) return false;
  if (family === 4) {
    return isNonPublicIpv4(normalized);
  }
  if (family === 6) {
    return isNonPublicIpv6(normalized);
  }
  return true;
}

function normalizeIpLiteral(address: string): string {
  const trimmed = address.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) return trimmed;
  return trimmed.slice(1, -1);
}

function isNonPublicIpv4(address: string): boolean {
  const [a, b, c] = address.split(".").map(Number);
  return a === 0
    || a === 10
    || a === 127
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 0 && (c === 0 || c === 2))
    || (a === 192 && b === 88 && c === 99)
    || (a === 192 && b === 168)
    || (a === 198 && (b === 18 || b === 19))
    || (a === 198 && b === 51 && c === 100)
    || (a === 203 && b === 0 && c === 113)
    || a >= 224;
}

function isNonPublicIpv6(address: string): boolean {
  const words = parseIpv6Words(address);
  if (!words) return true;

  const zeroPrefix = words[0] === 0 && words[1] === 0 && words[2] === 0
    && words[3] === 0 && words[4] === 0;
  if (zeroPrefix && words[5] === 0) {
    return isNonPublicIpv4(`${words[6]! >> 8}.${words[6]! & 0xff}.${words[7]! >> 8}.${words[7]! & 0xff}`);
  }
  if (zeroPrefix && words[5] === 0xffff) {
    return isNonPublicIpv4(`${words[6]! >> 8}.${words[6]! & 0xff}.${words[7]! >> 8}.${words[7]! & 0xff}`);
  }
  if (words[0] === 0x64 && words[1] === 0xff9b && words[2] === 0 && words[3] === 0
    && words[4] === 0 && words[5] === 0) {
    return isNonPublicIpv4(`${words[6]! >> 8}.${words[6]! & 0xff}.${words[7]! >> 8}.${words[7]! & 0xff}`);
  }

  return (words[0]! & 0xfe00) === 0xfc00
    || (words[0]! & 0xffc0) === 0xfe80
    || (words[0]! & 0xff00) === 0xff00
    || (words[0] === 0x100 && words[1] === 0 && words[2] === 0 && words[3] === 0)
    || (words[0] === 0x2001 && words[1] === 0xdb8)
    || (words[0] === 0x2001 && words[1] === 0x2)
    || (words[0] === 0x2001 && (words[1]! & 0xfff0) === 0x10);
}

function parseIpv6Words(address: string): number[] | null {
  const withoutZone = address.split("%")[0]!.toLowerCase();
  const halves = withoutZone.split("::");
  if (halves.length > 2) return null;
  const left = parseIpv6Half(halves[0] ?? "");
  const right = halves.length === 2 ? parseIpv6Half(halves[1] ?? "") : [];
  if (!left || !right) return null;
  const missing = 8 - left.length - right.length;
  if (halves.length === 2 ? missing < 1 : missing !== 0) return null;
  return [...left, ...Array.from({ length: missing }, () => 0), ...right];
}

function parseIpv6Half(value: string): number[] | null {
  if (!value) return [];
  const pieces = value.split(":");
  const words: number[] = [];
  for (const [index, piece] of pieces.entries()) {
    if (piece.includes(".")) {
      if (index !== pieces.length - 1) return null;
      const octets = piece.split(".").map(Number);
      if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
        return null;
      }
      words.push((octets[0]! << 8) | octets[1]!, (octets[2]! << 8) | octets[3]!);
      continue;
    }
    if (!/^[0-9a-f]{1,4}$/.test(piece)) return null;
    words.push(Number.parseInt(piece, 16));
  }
  return words;
}

function isPrivateHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/\.$/, "");
  return normalized === "localhost"
    || normalized.endsWith(".localhost")
    || normalized.endsWith(".local")
    || normalized.endsWith(".internal")
    || normalized.endsWith(".home.arpa")
    || isPrivateAddress(normalized);
}

export function createPublicOnlyHttpsAgent(): https.Agent {
  return new https.Agent({
    keepAlive: true,
    lookup: (hostname, options, callback) => {
      void lookup(hostname, { family: options.family, hints: options.hints, all: true }).then(
        (addresses) => {
          if (addresses.length === 0) {
            callback(new Error("Push endpoint did not resolve"), "", 0);
            return;
          }
          if (addresses.some((address) => isPrivateAddress(address.address))) {
            callback(new Error("Push endpoint resolved to a private address"), "", 0);
            return;
          }
          if (options.all) {
            callback(null, addresses);
          } else {
            callback(null, addresses[0]!.address, addresses[0]!.family);
          }
        },
        (error: Error) => callback(error, "", 0),
      );
    },
  });
}

function notificationThreadId(message: JsonRpcMessage): string | null {
  if (!("method" in message)) return null;
  const params = asObject(message.params);
  return readString(params, "threadId") ?? readString(asObject(params?.goal), "threadId");
}

function parseVapid(value: unknown): VapidKeys | null {
  const input = asObject(value);
  const publicKey = readString(input, "publicKey");
  const privateKey = readString(input, "privateKey");
  return publicKey && privateKey ? { publicKey, privateKey } : null;
}

function parseSubscription(value: unknown): PushSubscriptionRecord | null {
  const input = asObject(value);
  const keys = asObject(input?.keys);
  const userId = readString(input, "userId");
  const instance = readString(input, "instance");
  const endpoint = readString(input, "endpoint");
  const p256dh = readString(keys, "p256dh");
  const auth = readString(keys, "auth");
  if (!userId || !instance || !endpoint || !p256dh || !auth) return null;
  return {
    userId,
    email: readString(input, "email") ?? "",
    instance,
    endpoint,
    keys: { p256dh, auth },
    updatedAt: typeof input?.updatedAt === "number" ? input.updatedAt : 0,
    testDeliveredAt: typeof input?.testDeliveredAt === "number" ? input.testDeliveredAt : null,
  };
}

function sameSubscriptionTarget(
  record: PushSubscriptionRecord,
  endpoint: string,
  keys: PushSubscriptionKeys,
): boolean {
  return record.endpoint === endpoint
    && record.keys.p256dh === keys.p256dh
    && record.keys.auth === keys.auth;
}

function requiredString(value: unknown, name: string, maxLength: number): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} is required`);
  const normalized = value.trim();
  if (normalized.length > maxLength) throw new Error(`${name} is too long`);
  return normalized;
}

function errorStatus(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null || !("statusCode" in error)) return undefined;
  return typeof (error as { statusCode?: unknown }).statusCode === "number"
    ? (error as { statusCode: number }).statusCode
    : undefined;
}

function errorName(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

function rememberBounded(set: Set<string>, value: string, limit: number): void {
  set.add(value);
  if (set.size <= limit) return;
  const first = set.values().next().value;
  if (first !== undefined) set.delete(first);
}

function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readString(value: Record<string, unknown> | null | undefined, key: string): string | null {
  const field = value?.[key];
  return typeof field === "string" ? field : null;
}
