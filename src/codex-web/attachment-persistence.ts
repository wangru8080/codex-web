import { isImageFile, type FileAttachment } from "@/types";
import { v4 as createUuid } from "uuid";

type AppServerRequest = (method: string, params?: unknown) => Promise<unknown>;

type PersistImageAttachmentsParams = {
  files: readonly FileAttachment[];
  codexHome: string;
  platformFamily: string;
  request: AppServerRequest;
  createId?: () => string;
};

export async function persistImageAttachments({
  files,
  codexHome,
  platformFamily,
  request,
  createId = createUuid,
}: PersistImageAttachmentsParams): Promise<FileAttachment[]> {
  const separator = platformFamily === "windows" ? "\\" : "/";
  const persisted: FileAttachment[] = [];

  for (const file of files) {
    if (!isImageFile(file.type) || !file.data || file.filePath) {
      persisted.push(file);
      continue;
    }

    const directory = joinPath(codexHome, separator, "attachments", createId());
    const fileName = safeFileName(file.name, file.type);
    const filePath = joinPath(directory, separator, fileName);

    try {
      await request("fs/createDirectory", { path: directory, recursive: true });
      await request("fs/writeFile", { path: filePath, dataBase64: file.data });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`无法保存附件 ${file.name}: ${message}`);
    }

    persisted.push({ ...file, filePath });
  }

  return persisted;
}

function joinPath(root: string, separator: string, ...parts: string[]): string {
  const trimmedRoot = root.replace(/[\\/]+$/, "");
  return [trimmedRoot, ...parts].join(separator);
}

function safeFileName(name: string, mimeType: string): string {
  const basename = name.split(/[\\/]/).pop()?.trim() ?? "";
  const sanitized = basename.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_");
  if (sanitized && sanitized !== "." && sanitized !== "..") {
    return sanitized;
  }
  return `image.${extensionForMimeType(mimeType)}`;
}

function extensionForMimeType(mimeType: string): string {
  switch (mimeType.toLowerCase()) {
    case "image/jpeg": return "jpg";
    case "image/gif": return "gif";
    case "image/webp": return "webp";
    case "image/svg+xml": return "svg";
    default: return "png";
  }
}
