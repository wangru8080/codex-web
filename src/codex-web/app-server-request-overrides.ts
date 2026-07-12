import type { CollaborationMode } from "@/codex/protocol/generated/CollaborationMode";
import type { ThreadStartParams } from "@/codex/protocol/generated/v2/ThreadStartParams";
import type { TurnStartParams } from "@/codex/protocol/generated/v2/TurnStartParams";

/**
 * 当前生成的 TypeScript schema 尚未在 thread/start 与 turn/start params
 * 上暴露 collaborationMode，但真实 app-server 已验证接受该字段。
 * 兼容类型只允许 Web bridge 接线层使用；schema 更新后应删除本文件。
 */
export type CollaborationModeRequestOverride = {
  collaborationMode?: CollaborationMode;
};

export type ThreadStartParamsWithCollaborationMode =
  ThreadStartParams & CollaborationModeRequestOverride;

export type TurnStartParamsWithCollaborationMode =
  TurnStartParams & CollaborationModeRequestOverride;
