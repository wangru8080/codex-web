import type { UserInput } from "@/codex/protocol/generated/v2/UserInput";
import type { FileAttachment, SkillInputReference } from "@/types";

export function buildAppServerTurnInput(
  content: string,
  files: readonly FileAttachment[] = [],
  skills: readonly SkillInputReference[] = [],
): UserInput[] {
  const prompt = buildFilesMentionedPrompt(content, files);
  const input: UserInput[] = prompt ? [{ type: "text", text: prompt, text_elements: [] }] : [];
  for (const skill of skills) {
    if (!skill.name.trim() || !skill.path?.trim()) continue;
    input.push({ type: "skill", name: skill.name.trim(), path: skill.path.trim() });
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
