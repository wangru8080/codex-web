import type { Thread } from "@/codex/protocol/generated/v2/Thread";
import type { Message } from "@/types";

import { threadToMessages } from "./thread-history-adapter";

export function threadRollbackToMessages(thread: Thread): Message[] {
  return threadToMessages(thread).messages;
}
