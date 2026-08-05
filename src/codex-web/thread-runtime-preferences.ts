import type { ReasoningEffort } from "@/codex/protocol/generated/ReasoningEffort";
import type { PermissionProfile } from "@/types";

export type ThreadRuntimePreference = {
  model?: string;
  effort?: ReasoningEffort;
  permissionProfile?: PermissionProfile;
};

const STORAGE_PREFIX = "codex-web:thread-runtime-preference:v1:";
const PERMISSION_PROFILES = new Set<PermissionProfile>([
  "request_approval",
  "auto_approval",
  "full_access",
  "config",
]);

function storageKey(threadId: string): string {
  return `${STORAGE_PREFIX}${threadId}`;
}

export function readThreadRuntimePreference(
  storage: Pick<Storage, "getItem">,
  threadId: string,
): ThreadRuntimePreference | null {
  if (!threadId) return null;
  try {
    const value = JSON.parse(storage.getItem(storageKey(threadId)) ?? "null") as Record<string, unknown> | null;
    if (!value || typeof value !== "object") return null;
    const model = typeof value.model === "string" && value.model.trim() ? value.model : undefined;
    const effort = typeof value.effort === "string" && value.effort.trim() ? value.effort : undefined;
    const permissionProfile = typeof value.permissionProfile === "string"
      && PERMISSION_PROFILES.has(value.permissionProfile as PermissionProfile)
      ? value.permissionProfile as PermissionProfile
      : undefined;
    return model || effort || permissionProfile ? { model, effort, permissionProfile } : null;
  } catch {
    return null;
  }
}

export function writeThreadRuntimePreference(
  storage: Pick<Storage, "getItem" | "setItem">,
  threadId: string,
  update: ThreadRuntimePreference,
): ThreadRuntimePreference {
  const next = {
    ...readThreadRuntimePreference(storage, threadId),
    ...update,
  };
  try {
    storage.setItem(storageKey(threadId), JSON.stringify(next));
  } catch {
    // 浏览器禁用或写满 localStorage 时，app-server 更新仍应正常完成。
  }
  return next;
}
