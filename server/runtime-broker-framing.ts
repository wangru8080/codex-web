import type { Socket } from "node:net";
import { StringDecoder } from "node:string_decoder";

export const DEFAULT_BROKER_FRAME_BYTES = 16 * 1024 * 1024;

export class JsonLineDecoder {
  private readonly decoder = new StringDecoder("utf8");
  private buffer = "";

  constructor(private readonly maximumBytes = DEFAULT_BROKER_FRAME_BYTES) {}

  push(chunk: Buffer): unknown[] {
    this.buffer += this.decoder.write(chunk);
    const messages: unknown[] = [];
    let newline = this.buffer.indexOf("\n");
    while (newline >= 0) {
      const line = this.buffer.slice(0, newline);
      this.buffer = this.buffer.slice(newline + 1);
      this.assertSize(line);
      if (line.trim().length > 0) messages.push(parseLine(line));
      newline = this.buffer.indexOf("\n");
    }
    this.assertSize(this.buffer);
    return messages;
  }

  private assertSize(value: string): void {
    if (Buffer.byteLength(value, "utf8") > this.maximumBytes) {
      throw new Error(`broker 消息超过 ${this.maximumBytes} 字节上限`);
    }
  }
}

export function writeJsonLine(socket: Socket, value: unknown): void {
  socket.write(`${JSON.stringify(value)}\n`);
}

export function listenJsonLines(
  socket: Socket,
  onMessage: (message: unknown) => void,
  onError: (error: Error) => void,
  maximumBytes = DEFAULT_BROKER_FRAME_BYTES,
): () => void {
  const decoder = new JsonLineDecoder(maximumBytes);
  const onData = (chunk: Buffer) => {
    try {
      for (const message of decoder.push(chunk)) onMessage(message);
    } catch (error) {
      onError(error instanceof Error ? error : new Error(String(error)));
    }
  };
  socket.on("data", onData);
  return () => socket.off("data", onData);
}

function parseLine(line: string): unknown {
  try {
    return JSON.parse(line) as unknown;
  } catch {
    throw new Error("broker 消息 JSON 格式无效");
  }
}
