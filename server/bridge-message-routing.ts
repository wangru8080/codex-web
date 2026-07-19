import type { JsonRpcId, JsonRpcMessage } from "../src/codex/protocol/json-rpc";
import { CROSS_CLIENT_USER_MESSAGE_METHOD } from "../src/codex-web/cross-client-sync";

const SERVER_REQUEST_ID_PREFIX = "bridge-server-request:";

export type AppServerMessageDelivery = "broadcast" | "server-request" | "owner";

export function appServerMessageDelivery(message: JsonRpcMessage): AppServerMessageDelivery {
  if (!("method" in message)) {
    return "owner";
  }

  return message.id === undefined ? "broadcast" : "server-request";
}

export function isBridgeSyncNotification(message: JsonRpcMessage): boolean {
  return (
    "method" in message &&
    message.id === undefined &&
    message.method === CROSS_CLIENT_USER_MESSAGE_METHOD
  );
}

export class BridgeServerRequestRouter<TOwner> {
  private nextId = 1;
  private readonly pending = new Map<string, { owner: TOwner; originalId: JsonRpcId }>();

  register(owner: TOwner, originalId: JsonRpcId): string {
    const publicId = `${SERVER_REQUEST_ID_PREFIX}${this.nextId++}`;
    this.pending.set(publicId, { owner, originalId });
    return publicId;
  }

  take(publicId: JsonRpcId): { owner: TOwner; originalId: JsonRpcId } | null {
    if (typeof publicId !== "string") {
      return null;
    }

    const route = this.pending.get(publicId) ?? null;
    if (route) {
      this.pending.delete(publicId);
    }
    return route;
  }

  deleteOwner(owner: TOwner): void {
    for (const [publicId, route] of this.pending) {
      if (route.owner === owner) {
        this.pending.delete(publicId);
      }
    }
  }

  isPublicId(id: JsonRpcId): boolean {
    return typeof id === "string" && id.startsWith(SERVER_REQUEST_ID_PREFIX);
  }
}
