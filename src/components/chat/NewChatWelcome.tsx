'use client';

import { useEffect, useState } from 'react';
import { MonolithIcon } from '@/components/brand/MonolithIcon';
import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationKey } from '@/i18n';

/**
 * NewChatWelcome — single-line hero above the composer on the new-chat
 * surface (the /chat page, and ChatView's empty state).
 *
 * The line is composed as "{time salutation}{sep}{question}" so it
 * reads as alive rather than a fixed prompt:
 *   - the salutation reflects the time of day (morning / afternoon /
 *     evening / late night);
 *   - the question pool depends on context — assistant workspace, an
 *     explicitly named project, or general.
 *
 * SSR / hydration: the time, the context-derived pool, and the random
 * pick are ALL decided in a client-only effect. The first paint (server
 * + first client render) shows a fixed neutral question so both passes
 * match. An earlier `useMemo(() => Math.random())` version ran twice
 * with different results and produced a hydration mismatch whose console
 * noise masked the Phase 7b vibrancy smoke (Codex round 3 review). Keep
 * the non-deterministic compute inside useEffect.
 */

const GENERAL_KEYS = [
  'chat.newChat.welcome.1',
  'chat.newChat.welcome.2',
  'chat.newChat.welcome.3',
  'chat.newChat.welcome.4',
  'chat.newChat.welcome.5',
  'chat.newChat.welcome.6',
] as const;

const PROJECT_KEY = 'chat.newChat.welcome.project.1' as const;

const ASSISTANT_KEYS = [
  'chat.newChat.welcome.assistant.1',
  'chat.newChat.welcome.assistant.2',
  'chat.newChat.welcome.assistant.3',
] as const;

function greetKeyForHour(hour: number): TranslationKey {
  if (hour >= 5 && hour < 12) return 'chat.newChat.greet.morning' as TranslationKey;
  if (hour >= 12 && hour < 18) return 'chat.newChat.greet.afternoon' as TranslationKey;
  if (hour >= 18 && hour < 23) return 'chat.newChat.greet.evening' as TranslationKey;
  return 'chat.newChat.greet.night' as TranslationKey;
}

function pick<T>(arr: ReadonlyArray<T>): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

interface NewChatWelcomeProps {
  /** Explicit project display name. Do not infer this from a local path. */
  projectName?: string;
  /** True when the active workspace is the assistant workspace. */
  isAssistant?: boolean;
}

export function NewChatWelcome({ projectName, isAssistant }: NewChatWelcomeProps = {}) {
  const { t } = useTranslation();
  // null on the first paint → render the neutral fallback below so the
  // server and first client render agree; the composed greeting is set
  // once the client-only effect runs.
  const [greeting, setGreeting] = useState<string | null>(null);

  useEffect(() => {
    const salutation = t(greetKeyForHour(new Date().getHours()));
    const sep = t('chat.newChat.greet.sep' as TranslationKey);
    const project = projectName?.trim() ?? '';

    let question: string;
    if (project && !isAssistant) {
      setGreeting(t(PROJECT_KEY as TranslationKey, { project }));
      return;
    }

    if (isAssistant) {
      question = t(pick(ASSISTANT_KEYS) as TranslationKey);
    } else {
      question = t(pick(GENERAL_KEYS) as TranslationKey);
    }

    setGreeting(`${salutation}${sep}${question}`);
  }, [t, projectName, isAssistant]);

  return (
    <div className="flex items-center justify-center gap-3 mb-8">
      <MonolithIcon className="h-9 w-9 shrink-0" />
      <h1 className="text-3xl font-medium tracking-tight text-foreground leading-none">
        {greeting ?? t('chat.newChat.welcome.1' as TranslationKey)}
      </h1>
    </div>
  );
}
