import type { Message } from "@/types";

export function latestEditableUserMessageId(
  messages: readonly Message[],
  isStreaming: boolean,
): string | null {
  if (isStreaming || messages.at(-1)?.role !== "assistant") {
    return null;
  }

  for (let index = messages.length - 2; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") {
      return messages[index]?.id ?? null;
    }
  }

  return null;
}

export function dropLastUserTurns(
  messages: readonly Message[],
  numTurns: number,
): Message[] {
  let end = messages.length;
  for (let turn = 0; turn < numTurns; turn += 1) {
    let userIndex = -1;
    for (let index = end - 1; index >= 0; index -= 1) {
      if (messages[index]?.role === "user") {
        userIndex = index;
        break;
      }
    }
    if (userIndex < 0) break;
    end = userIndex;
  }
  return messages.slice(0, end);
}
