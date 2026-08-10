import { EventEmitter } from "node:events";
import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";

import {
  parseJsonRpcMessage,
  type JsonRpcId,
  type JsonRpcMessage,
  type JsonRpcNotification,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from "../src/codex/protocol/json-rpc";

export type JsonRpcClientOptions = {
  input: Readable;
  output: Writable;
  closeEmitter?: EventEmitter;
};

export type JsonRpcClientEvents = {
  notification: [JsonRpcNotification];
  serverRequest: [JsonRpcRequest];
  message: [JsonRpcMessage];
  error: [Error];
  close: [Error | undefined];
};

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

export class JsonRpcClient extends EventEmitter<JsonRpcClientEvents> {
  private nextId = 1;
  private readonly pending = new Map<JsonRpcId, PendingRequest>();
  private closed = false;

  constructor(private readonly options: JsonRpcClientOptions) {
    super();

    const lines = createInterface({ input: options.input });
    lines.on("line", (line) => this.handleLine(line));
    lines.on("close", () => this.close(new Error("app-server stdout 已关闭")));
    options.input.on("error", (error) => this.close(error));
    options.output.on("error", (error) => this.close(error));
    options.closeEmitter?.on("exit", () => this.close(new Error("app-server 进程已退出")));
    options.closeEmitter?.on("error", (error) => this.close(error));
  }

  request(method: string, params?: unknown): Promise<unknown> {
    const id = this.nextId++;
    const message = params === undefined ? { id, method } : { id, method, params };

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try {
        this.write(message);
      } catch (error) {
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  notify(method: string, params?: unknown): void {
    const message = params === undefined ? { method } : { method, params };
    this.write(message);
  }

  sendRaw(message: JsonRpcRequest | JsonRpcNotification | JsonRpcResponse): void {
    this.write(message);
  }

  failPending(error: Error): void {
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
  }

  isClosed(): boolean {
    return this.closed;
  }

  close(error?: Error): void {
    if (this.closed) {
      return;
    }

    this.closed = true;
    this.failPending(error ?? new Error("JSON-RPC transport 已关闭"));
    this.emit("close", error);
  }

  private handleLine(line: string): void {
    if (line.trim().length === 0) {
      return;
    }

    try {
      const message = parseJsonRpcMessage(line);
      this.emit("message", message);

      if ("method" in message && message.id !== undefined) {
        this.emit("serverRequest", message);
        return;
      }

      if ("method" in message) {
        this.emit("notification", message);
        return;
      }

      this.handleResponse(message);
    } catch (error) {
      this.emit("error", error instanceof Error ? error : new Error(String(error)));
    }
  }

  private handleResponse(response: JsonRpcResponse): void {
    const pending = this.pending.get(response.id);
    if (!pending) {
      return;
    }

    this.pending.delete(response.id);
    if (response.error) {
      pending.reject(new Error(response.error.message));
      return;
    }

    pending.resolve(response.result);
  }

  private write(message: JsonRpcMessage): void {
    if (this.closed) {
      throw new Error("JSON-RPC transport 已关闭");
    }

    this.options.output.write(`${JSON.stringify(message)}\n`);
  }
}
