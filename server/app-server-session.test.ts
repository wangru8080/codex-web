import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";

import { AppServerSession, type AppServerSessionTransport } from "./app-server-session";

describe("AppServerSession", () => {
  it("按 app-server 生命周期执行 initialize、initialized、model/list、account/read", async () => {
    const client = new MockRpcClient({
      initialize: {
        userAgent: "codex_web/0.143.0",
        codexHome: "/volume2/SSD/codex/Temp/codex-dev-home",
        platformFamily: "unix",
        platformOs: "linux",
      },
      "model/list": { data: [], nextCursor: null },
      "account/read": { account: null, requiresOpenaiAuth: true },
    });
    const session = new AppServerSession(client);

    const result = await session.bootstrap();

    expect(result.initialize.source).toBe("app-server.initialize");
    expect(result.models.source).toBe("app-server.model/list");
    expect(result.account.source).toBe("app-server.account/read");
    expect(client.calls).toEqual([
      [
        "request",
        "initialize",
        {
          clientInfo: { name: "codex_web", title: "Codex Web", version: "0.0.0" },
          capabilities: {
            experimentalApi: true,
            requestAttestation: false,
            mcpServerOpenaiFormElicitation: false,
          },
        },
      ],
      ["notify", "initialized", undefined],
      ["request", "model/list", { includeHidden: false }],
      ["request", "account/read", { refreshToken: false }],
    ]);
  });

  it("保留未知 notification 作为 diagnostics", () => {
    const client = new MockRpcClient({});
    const session = new AppServerSession(client);

    client.emit("notification", { method: "unknown/event", params: { value: 1 } });

    expect(session.diagnostics).toEqual([
      {
        source: "app-server.notification",
        data: { method: "unknown/event", params: { value: 1 } },
      },
    ]);
  });
});

class MockRpcClient extends EventEmitter implements AppServerSessionTransport {
  readonly calls: Array<["request" | "notify", string, unknown]> = [];

  constructor(private readonly responses: Record<string, unknown>) {
    super();
  }

  request(method: string, params?: unknown): Promise<unknown> {
    this.calls.push(["request", method, params]);
    return Promise.resolve(this.responses[method]);
  }

  notify(method: string, params?: unknown): void {
    this.calls.push(["notify", method, params]);
  }

  onNotification(listener: (notification: { method: string; params?: unknown }) => void): void {
    this.on("notification", listener);
  }
}
