import { accessSync, constants } from "node:fs";
import { connect } from "node:net";
import { join } from "node:path";
import { PassThrough, Writable } from "node:stream";
import WebSocket from "ws";

import { startCodexAppServer, type CodexProcessOptions } from "./codex-process";
import { JsonRpcClient } from "./json-rpc-client";

export type AppServerRuntime = {
  rpc: JsonRpcClient;
  diagnostics: string[];
  kind: "control-socket" | "stdio";
  pid: number | undefined;
  stop: () => void;
};

export function startAppServerRuntime(options: CodexProcessOptions = {}): AppServerRuntime {
  const socketPath = resolveAppServerControlSocket(options);
  if (socketPath) return startControlSocketRuntime(socketPath);

  const process = startCodexAppServer(options);
  return {
    rpc: new JsonRpcClient({
      input: process.child.stdout,
      output: process.child.stdin,
      closeEmitter: process.child,
    }),
    diagnostics: process.diagnostics,
    kind: "stdio",
    pid: process.child.pid,
    stop: process.stop,
  };
}

export function resolveAppServerControlSocket(
  options: CodexProcessOptions,
  platform: NodeJS.Platform = process.platform,
  canAccess: (path: string) => boolean = canAccessSocket,
): string | null {
  if (platform === "win32") return null;
  const codexHome = effectiveCodexHome(options);
  if (!codexHome) return null;
  const socketPath = join(codexHome, "app-server-control", "app-server-control.sock");
  return canAccess(socketPath) ? socketPath : null;
}

function effectiveCodexHome(options: CodexProcessOptions): string | null {
  const explicit = options.codexHome?.trim();
  if (explicit) return explicit;
  const optionEnv = options.env?.CODEX_HOME?.trim();
  if (optionEnv) return optionEnv;
  if (options.inheritEnv === false) return null;
  return process.env.CODEX_HOME?.trim() || null;
}

function canAccessSocket(path: string): boolean {
  try {
    accessSync(path, constants.R_OK | constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function startControlSocketRuntime(socketPath: string): AppServerRuntime {
  const diagnostics: string[] = [];
  const input = new PassThrough();
  const socket = new WebSocket("ws://localhost/rpc", {
    createConnection: () => connect(socketPath),
    perMessageDeflate: false,
  });
  const output = new Writable({
    write(chunk, _encoding, callback) {
      sendWebSocketText(socket, chunk.toString().trimEnd(), callback);
    },
  });
  const rpc = new JsonRpcClient({ input, output });

  socket.on("message", (data) => input.write(`${data.toString()}\n`));
  socket.on("error", (error) => pushDiagnostic(diagnostics, error.message));
  socket.on("close", () => input.end());

  return {
    rpc,
    diagnostics,
    kind: "control-socket",
    pid: undefined,
    stop: () => {
      output.end();
      if (socket.readyState === WebSocket.CONNECTING) socket.terminate();
      else if (socket.readyState === WebSocket.OPEN) socket.close();
    },
  };
}

function sendWebSocketText(
  socket: WebSocket,
  serialized: string,
  callback: (error?: Error | null) => void,
): void {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(serialized, callback);
    return;
  }
  if (socket.readyState !== WebSocket.CONNECTING) {
    callback(new Error("app-server control socket 已关闭"));
    return;
  }

  const cleanup = () => {
    socket.off("open", handleOpen);
    socket.off("error", handleError);
    socket.off("close", handleClose);
  };
  const handleOpen = () => {
    cleanup();
    socket.send(serialized, callback);
  };
  const handleError = (error: Error) => {
    cleanup();
    callback(error);
  };
  const handleClose = () => {
    cleanup();
    callback(new Error("app-server control socket 已关闭"));
  };
  socket.once("open", handleOpen);
  socket.once("error", handleError);
  socket.once("close", handleClose);
}

function pushDiagnostic(diagnostics: string[], message: string): void {
  diagnostics.push(message);
  if (diagnostics.length > 50) diagnostics.splice(0, diagnostics.length - 50);
}
