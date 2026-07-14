import type { FsReadDirectoryEntry } from "@/codex/protocol/generated/v2/FsReadDirectoryEntry";

export type BrowsableDirectory = {
  name: string;
  path: string;
};

export type DirectoryCompletionQuery = {
  parentPath: string;
  fragment: string;
};

export function directoryParent(path: string): string | null {
  const normalized = trimDirectorySeparator(path.trim());
  if (!normalized || normalized === "/" || /^[A-Za-z]:$/.test(normalized)) {
    return null;
  }

  const separator = directorySeparator(normalized);
  const index = normalized.lastIndexOf(separator);
  if (index < 0) return null;
  if (index === 0) return separator;
  if (index === 2 && /^[A-Za-z]:/.test(normalized)) return `${normalized.slice(0, 2)}${separator}`;
  return normalized.slice(0, index);
}

export function directoryChildren(
  currentPath: string,
  entries: FsReadDirectoryEntry[],
): BrowsableDirectory[] {
  return entries
    .filter((entry) => entry.isDirectory)
    .map((entry) => ({
      name: entry.fileName,
      path: joinDirectoryPath(currentPath, entry.fileName),
    }))
    .sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: "base" }));
}

export function directoryCompletionQuery(
  inputPath: string,
  fallbackDirectory: string,
): DirectoryCompletionQuery {
  const value = inputPath.trim();
  const fallback = fallbackDirectory.trim() || "/";
  if (!value) {
    return { parentPath: fallback, fragment: "" };
  }

  const separatorIndex = Math.max(value.lastIndexOf("/"), value.lastIndexOf("\\"));
  if (separatorIndex < 0) {
    return { parentPath: fallback, fragment: value };
  }

  const fragment = value.slice(separatorIndex + 1);
  if (separatorIndex === 0) {
    return { parentPath: value[0], fragment };
  }
  if (separatorIndex === 2 && /^[A-Za-z]:[\\/]/.test(value)) {
    return { parentPath: value.slice(0, 3), fragment };
  }
  return { parentPath: value.slice(0, separatorIndex), fragment };
}

export function matchingDirectories(
  inputPath: string,
  fallbackDirectory: string,
  entries: FsReadDirectoryEntry[],
): BrowsableDirectory[] {
  const query = directoryCompletionQuery(inputPath, fallbackDirectory);
  const fragment = query.fragment.toLocaleLowerCase();
  return directoryChildren(query.parentPath, entries)
    .filter((directory) => directory.name.toLocaleLowerCase().startsWith(fragment));
}

export function joinDirectoryPath(parent: string, child: string): string {
  const normalized = trimDirectorySeparator(parent.trim());
  const separator = directorySeparator(parent);
  if (!normalized || normalized === separator) {
    return `${separator}${child}`;
  }
  if (/^[A-Za-z]:$/.test(normalized)) {
    return `${normalized}${separator}${child}`;
  }
  return `${normalized}${separator}${child}`;
}

function directorySeparator(path: string): "/" | "\\" {
  return path.includes("\\") && !path.includes("/") ? "\\" : "/";
}

function trimDirectorySeparator(path: string): string {
  if (path === "/" || /^[A-Za-z]:[\\/]?$/.test(path)) {
    return path.replace(/\\$/, "");
  }
  return path.replace(/[\\/]+$/, "");
}
