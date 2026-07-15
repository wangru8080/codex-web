import type { UserInput } from "@/codex/protocol/generated/v2/UserInput";
import { isImageFile, type FileAttachment } from "@/types";

export function buildAppServerTurnInput(
  content: string,
  files: readonly FileAttachment[] = [],
): UserInput[] {
  const input: UserInput[] = [];

  for (const file of files) {
    if (!isImageFile(file.type)) continue;
    if (file.data) {
      input.push({
        type: "image",
        url: `data:${file.type};base64,${file.data}`,
      });
    } else if (file.filePath) {
      input.push({ type: "localImage", path: file.filePath });
    }
  }

  if (content) {
    input.push({ type: "text", text: content, text_elements: [] });
  }

  return input;
}
