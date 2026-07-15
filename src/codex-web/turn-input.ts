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

  const prompt = buildFilesMentionedPrompt(content, files);
  if (prompt) {
    input.push({ type: "text", text: prompt, text_elements: [] });
  }

  return input;
}

export function buildFilesMentionedPrompt(
  content: string,
  files: readonly FileAttachment[],
): string {
  const mentionedFiles = files.filter(
    (file) => file.filePath && !file.originPath && file.type !== "inode/directory",
  );
  if (mentionedFiles.length === 0) return content;

  const entries = mentionedFiles
    .map((file) => `## ${file.name}: ${file.filePath}`)
    .join("\n\n");
  return `\n# Files mentioned by the user:\n\n${entries}\n\n## My request for Codex:\n${content}\n`;
}
