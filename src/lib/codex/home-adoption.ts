import {
  createSession,
  getAllSessions,
  getSession,
  updateCodexHomeBinding,
  updateCodexThreadId,
  updateSessionRuntime,
} from '@/lib/db';
import type { ChatSession, Message } from '@/types';
import {
  fromCodexVirtualSessionId,
  getCodexRolloutMeta,
} from './session-rollouts';

import type { PermissionProfile } from '@/types';

export interface AdoptCodexHomeSessionInput {
  codexHome?: string;
  id: string;
  cwd: string;
  model?: string;
  permissionProfile?: PermissionProfile;
}

export interface AdoptCodexHomeSessionResult {
  session: ChatSession;
  resume: {
    adopted: true;
    codexSessionId: string;
    modelProvider: string;
  };
}

export function mergeCodexHomeMessages(input: {
  codexMessages: Message[];
  localMessages: Message[];
}): Message[] {
  return [...input.codexMessages, ...input.localMessages].map((message, index) => ({
    ...message,
    _rowid: index + 1,
  }));
}

export function codexHomeMessagesForDisplay(input: {
  codexMessages: Message[];
  localMessages: Message[];
}): Message[] {
  const source = input.codexMessages.length > 0
    ? input.codexMessages
    : input.localMessages;
  return source.map((message, index) => ({
    ...message,
    _rowid: index + 1,
  }));
}

export async function adoptCodexHomeSession(
  input: AdoptCodexHomeSessionInput,
): Promise<AdoptCodexHomeSessionResult> {
  const meta = await getCodexRolloutMeta(input.id, {
    codexHome: input.codexHome,
    cwd: input.cwd,
  });
  if (!meta) {
    throw new Error('Codex 历史会话不存在，或不属于当前项目 / 当前 model_provider。');
  }

  const existing = getAllSessions({ includeSources: ['user'] }).find((session) => (
    session.codex_home_session_id === meta.sessionId
  ));
  if (existing) {
    return {
      session: existing,
      resume: {
        adopted: true,
        codexSessionId: meta.sessionId,
        modelProvider: meta.modelProvider,
      },
    };
  }

  const codexSessionId = fromCodexVirtualSessionId(input.id);
  const session = createSession(
    `Codex 历史：${codexSessionId.slice(0, 8)}`,
    input.model || meta.model,
    '',
    meta.cwd,
    'code',
    'codex_account',
    input.permissionProfile || 'request_approval',
  );
  updateSessionRuntime(session.id, 'codex_runtime');
  updateCodexThreadId(session.id, meta.sessionId, 'codex_account', '');
  updateCodexHomeBinding(session.id, {
    sessionId: meta.sessionId,
    modelProvider: meta.modelProvider,
  });

  const adopted = getSession(session.id);
  if (!adopted) {
    throw new Error('Codex Home 接管会话创建失败。');
  }

  return {
    session: adopted,
    resume: {
      adopted: true,
      codexSessionId: meta.sessionId,
      modelProvider: meta.modelProvider,
    },
  };
}
