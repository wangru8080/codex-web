export type JsonRpcId = string | number;

export type JsonRpcRequest<TParams = unknown> = {
  id: JsonRpcId;
  method: string;
  params?: TParams;
};

export type JsonRpcNotification<TParams = unknown> = {
  id?: never;
  method: string;
  params?: TParams;
};

export type JsonRpcError = {
  code: number;
  message: string;
  data?: unknown;
};

export type JsonRpcResponse<TResult = unknown> = {
  id: JsonRpcId;
  result?: TResult;
  error?: JsonRpcError;
};

export type JsonRpcMessage =
  | JsonRpcRequest
  | JsonRpcNotification
  | JsonRpcResponse;

export function parseJsonRpcMessage(line: string): JsonRpcMessage {
  const parsed: unknown = JSON.parse(line);

  if (!isRecord(parsed)) {
    throw new Error("JSON-RPC 消息必须是对象");
  }

  if (typeof parsed.method === "string") {
    return parseRequestOrNotification(parsed);
  }

  if (isJsonRpcId(parsed.id)) {
    return parseResponse(parsed);
  }

  throw new Error("无法识别 JSON-RPC 消息");
}

function parseRequestOrNotification(
  message: Record<string, unknown>,
): JsonRpcRequest | JsonRpcNotification {
  const method = message.method as string;
  const params = message.params;

  if ("id" in message) {
    if (!isJsonRpcId(message.id)) {
      throw new Error("JSON-RPC request id 必须是字符串或数字");
    }

    return params === undefined
      ? { id: message.id, method }
      : { id: message.id, method, params };
  }

  return params === undefined ? { method } : { method, params };
}

function parseResponse(message: Record<string, unknown>): JsonRpcResponse {
  const hasResult = "result" in message;
  const hasError = "error" in message;

  if (hasResult === hasError) {
    throw new Error("JSON-RPC response 必须且只能包含 result 或 error");
  }

  if (hasError && !isJsonRpcError(message.error)) {
    throw new Error("JSON-RPC error 格式不正确");
  }

  return hasResult
    ? { id: message.id as JsonRpcId, result: message.result }
    : { id: message.id as JsonRpcId, error: message.error as JsonRpcError };
}

function isJsonRpcId(value: unknown): value is JsonRpcId {
  return typeof value === "string" || typeof value === "number";
}

function isJsonRpcError(value: unknown): value is JsonRpcError {
  return (
    isRecord(value) &&
    typeof value.code === "number" &&
    typeof value.message === "string"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
