import type { ConfigEdit } from "@/codex/protocol/generated/v2/ConfigEdit";
import type { HookMetadata } from "@/codex/protocol/generated/v2/HookMetadata";

export function hookNeedsReview(hook: Pick<HookMetadata, "trustStatus">): boolean {
  return hook.trustStatus === "untrusted" || hook.trustStatus === "modified";
}

export function buildHookTrustEdit(hooks: readonly HookMetadata[]): ConfigEdit {
  return {
    keyPath: "hooks.state",
    value: Object.fromEntries(
      hooks
        .filter(hookNeedsReview)
        .map((hook) => [hook.key, { trusted_hash: hook.currentHash }]),
    ),
    mergeStrategy: "upsert",
  };
}

export function buildHookEnabledEdit(key: string, enabled: boolean): ConfigEdit {
  return {
    keyPath: "hooks.state",
    value: { [key]: { enabled } },
    mergeStrategy: "upsert",
  };
}
