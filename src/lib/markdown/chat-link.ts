import { splitPathAndAnchor } from "./anchor";
import { isPotentialLocalFile } from "./local-link-detector";

export type ChatLinkTarget =
  | { kind: "local-file"; href: string; filePath: string; anchor?: string }
  | { kind: "remote"; href: string }
  | { kind: "relative"; href: string }
  | { kind: "blocked"; href: string };

const SAFE_REMOTE_PROTOCOL = /^(?:https?|mailto|tel):/i;
const ANY_PROTOCOL = /^[a-z][a-z0-9+.-]*:/i;

export function classifyChatLinkHref(href: string): ChatLinkTarget {
  const normalized = href.trim();
  if (SAFE_REMOTE_PROTOCOL.test(normalized) || normalized.startsWith("//")) {
    return { kind: "remote", href: normalized };
  }
  if (ANY_PROTOCOL.test(normalized)) {
    return { kind: "blocked", href: normalized };
  }

  const { filePath, anchor } = splitPathAndAnchor(normalized);
  const decodedFilePath = decodeLocalPath(filePath);
  if (isPotentialLocalFile(decodedFilePath)) {
    return {
      kind: "local-file",
      href: normalized,
      filePath: decodedFilePath,
      ...(anchor ? { anchor } : {}),
    };
  }
  return { kind: "relative", href: normalized };
}

function decodeLocalPath(filePath: string): string {
  try {
    return decodeURIComponent(filePath);
  } catch {
    return filePath;
  }
}
