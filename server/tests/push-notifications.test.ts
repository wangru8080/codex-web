import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import type { JsonRpcRequest } from "../../src/codex/protocol/json-rpc";
import {
  PUSH_CONFIG_METHOD,
  PUSH_REGISTER_METHOD,
  PUSH_UNREGISTER_METHOD,
  PushNotificationService,
  isPrivateAddress,
  validatePushEndpoint,
} from "../push-notifications";

const user = { id: "alice", email: "alice@example.test" };
const keys = {
  p256dh: "BL7ELU24fJTAlH5Kyl8N6BDCac8u8li_U5PIwG963MOvdYs9s7LSzj8x_7v7RFdLZ9Eap50PiiyF5K0TDAis7t0",
  auth: "juarI8x__VnHvsOgfeAPHg",
};

async function serviceFixture() {
  const directory = await mkdtemp(join(tmpdir(), "codex-web-push-"));
  const sent: Array<{ endpoint: string; payload: string; subject: string }> = [];
  let statusCode = 201;
  const transport = {
    generateVapidKeys: () => ({ publicKey: "vapid-public", privateKey: "vapid-private" }),
    send: vi.fn(async (subscription: { endpoint: string }, payload: string, vapid: { subject: string }) => {
      sent.push({ endpoint: subscription.endpoint, payload, subject: vapid.subject });
      return { statusCode };
    }),
  };
  const service = new PushNotificationService({
    statePath: join(directory, "push.json"),
    env: {},
    transport,
    now: () => 1_700_000_000_000,
    logger: { warn: vi.fn(), info: vi.fn() },
  });
  return {
    directory,
    service,
    sent,
    transport,
    setStatusCode: (status: number) => { statusCode = status; },
  };
}

function request(method: string, id: number, params: unknown): JsonRpcRequest {
  return { id, method, params };
}

async function register(service: PushNotificationService, instance = "codex-web-default") {
  return service.handleClientRequest(user, request(PUSH_REGISTER_METHOD, 1, {
    instance,
    endpoint: "https://push.example.test/endpoint/secret",
    keys,
  }));
}

describe("UnifiedPush notification service", () => {
  it("registers an encrypted endpoint, exposes a stable VAPID key, and writes private state", async () => {
    const { service, directory } = await serviceFixture();
    const config = await service.handleClientRequest(user, request(PUSH_CONFIG_METHOD, 2, {}));
    expect(config).toEqual({
      id: 2,
      result: { vapidPublicKey: "vapid-public", source: "codex-web.push" },
    });
    expect(await register(service)).toMatchObject({
      result: { registered: true, testNotification: { delivered: true, statusCode: 201 } },
    });
    expect(await register(service)).toMatchObject({
      result: { registered: true, testNotification: { delivered: true, statusCode: 201 } },
    });

    const stored = JSON.parse(await readFile(join(directory, "push.json"), "utf8"));
    expect(stored.subscriptions).toHaveLength(1);
    expect(stored.vapid).toEqual({ publicKey: "vapid-public", privateKey: "vapid-private" });
    expect((await stat(join(directory, "push.json"))).mode & 0o777).toBe(0o600);
    expect((await stat(directory)).mode & 0o777).toBe(0o700);
  });

  it("sends a test notification when a device registers", async () => {
    const { service, sent } = await serviceFixture();
    const response = await register(service, "sunup-device");

    expect(response).toMatchObject({
      result: {
        registered: true,
        testNotification: { delivered: true, statusCode: 201 },
      },
    });
    expect(sent).toHaveLength(1);
    expect(JSON.parse(sent[0]!.payload)).toMatchObject({
      kind: "test",
      title: "Codex Web notifications are working",
      requestId: "registration-test",
    });
  });

  it("reports a failed registration test while retaining the subscription", async () => {
    const { directory, service, setStatusCode } = await serviceFixture();
    setStatusCode(503);

    const response = await register(service);

    expect(response).toMatchObject({
      result: {
        registered: true,
        testNotification: {
          delivered: false,
          statusCode: 503,
          error: "Push service returned HTTP 503",
        },
      },
    });
    const stored = JSON.parse(await readFile(join(directory, "push.json"), "utf8"));
    expect(stored.subscriptions).toHaveLength(1);
  });

  it("sends only filtered Codex events and deduplicates repeated turn notifications", async () => {
    const { service, sent } = await serviceFixture();
    await register(service);
    sent.length = 0;

    service.handleAppServerMessage(user, {
      method: "item/agentMessage/delta",
      params: { threadId: "thread-1", delta: "not a notification" },
    });
    expect(sent).toHaveLength(0);

    const completed = {
      method: "turn/completed" as const,
      params: {
        threadId: "thread-1",
        turn: {
          id: "turn-1",
          status: "completed",
          items: [{ id: "item-1", type: "agentMessage", text: "Done." }],
        },
      },
    };
    service.handleAppServerMessage(user, completed);
    service.handleAppServerMessage(user, completed);
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(JSON.parse(sent[0]!.payload)).toMatchObject({
      kind: "turn_completed",
      body: "Done.",
      threadId: "thread-1",
    });
    expect(sent[0]!.subject).toBe("https://github.com/wangru8080/codex-web");
  });

  it("does not deliver another user's events or subscriptions", async () => {
    const { service, sent } = await serviceFixture();
    await register(service);
    sent.length = 0;
    service.handleAppServerMessage({ id: "bob", email: "bob@example.test" }, {
      method: "turn/completed",
      params: {
        threadId: "thread-2",
        turn: { id: "turn-2", status: "completed", items: [] },
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(sent).toHaveLength(0);
  });

  it("unregisters the exact instance and drops stale endpoints", async () => {
    const { directory, service, sent, setStatusCode } = await serviceFixture();
    await register(service, "one");
    await register(service, "two");
    sent.length = 0;
    setStatusCode(410);
    service.handleAppServerMessage(user, {
      method: "turn/completed",
      params: {
        threadId: "thread-1",
        turn: { id: "turn-1", status: "completed", items: [] },
      },
    });
    await vi.waitFor(() => expect(sent).toHaveLength(2));
    await vi.waitFor(async () => {
      const stored = JSON.parse(await readFile(join(directory, "push.json"), "utf8"));
      expect(stored.subscriptions).toHaveLength(0);
    });
  });

  it("unregisters only the requested instance", async () => {
    const { directory, service } = await serviceFixture();
    await register(service, "one");
    await register(service, "two");
    const response = await service.handleClientRequest(user, request(PUSH_UNREGISTER_METHOD, 9, {
      instance: "one",
    }));
    expect(response).toMatchObject({ result: { unregistered: true } });
    const stored = JSON.parse(await readFile(join(directory, "push.json"), "utf8"));
    expect(stored.subscriptions.map((subscription: { instance: string }) => subscription.instance))
      .toEqual(["two"]);
  });

  it("rejects insecure or private push endpoints", () => {
    expect(() => validatePushEndpoint("http://push.example.test/endpoint")).toThrow("HTTPS");
    expect(() => validatePushEndpoint("https://127.0.0.1/endpoint")).toThrow("publicly routable");
    expect(() => validatePushEndpoint("https://localhost/endpoint")).toThrow("publicly routable");
    expect(() => validatePushEndpoint("https://[::1]/endpoint")).toThrow("publicly routable");
    expect(() => validatePushEndpoint("https://[fd00::1]/endpoint")).toThrow("publicly routable");
    expect(() => validatePushEndpoint("https://[::ffff:127.0.0.1]/endpoint")).toThrow("publicly routable");
    expect(isPrivateAddress("10.1.2.3")).toBe(true);
    expect(isPrivateAddress("169.254.169.254")).toBe(true);
    expect(isPrivateAddress("198.51.100.20")).toBe(true);
    expect(isPrivateAddress("[::1]")).toBe(true);
    expect(isPrivateAddress("::ffff:7f00:1")).toBe(true);
    expect(isPrivateAddress("2606:4700:4700::1111")).toBe(false);
    expect(isPrivateAddress("8.8.8.8")).toBe(false);
    expect(isPrivateAddress("example.test")).toBe(false);
    expect(validatePushEndpoint("https://push.example.test/endpoint")).toBe("https://push.example.test/endpoint");
    expect(validatePushEndpoint("https://[2606:4700:4700::1111]/endpoint"))
      .toBe("https://[2606:4700:4700::1111]/endpoint");
  });

  it("requires the UnifiedPush endpoint's Web Push keys", async () => {
    const { service } = await serviceFixture();
    const response = await service.handleClientRequest(user, request(PUSH_REGISTER_METHOD, 3, {
      instance: "codex-web-default",
      endpoint: "https://push.example.test/endpoint",
    }));
    expect(response).toMatchObject({
      error: { code: -32602, message: "keys.p256dh is required" },
    });
  });
});
