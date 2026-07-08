import { useState, useCallback } from 'react';
import type { CommandBadge, CliBadge } from '@/types';

export type { CommandBadge, CliBadge } from '@/types';

export interface UseCommandBadgeReturn {
  /** Active slash-command/skill badges. Empty array = no badge. Multi-element
   * array only happens when all entries are `agent_skill` kind (multi-skill
   * selection); other kinds replace instead of appending — it makes no sense to
   * run /clear AND /help together. */
  badges: CommandBadge[];
  /** Add a badge. For `agent_skill` kind, appends (with de-dup by command);
   * for other kinds, replaces any existing badges entirely. */
  addBadge: (badge: CommandBadge) => void;
  /** Remove a single badge by its command identifier. */
  removeBadge: (command: string) => void;
  /** Clear all badges. */
  clearBadges: () => void;
  cliBadge: CliBadge | null;
  setCliBadge: (badge: CliBadge | null) => void;
  removeCliBadge: () => void;
  hasBadge: boolean;
}

export function useCommandBadge(
  textareaRef: React.RefObject<HTMLTextAreaElement | null>,
): UseCommandBadgeReturn {
  const [badges, setBadges] = useState<CommandBadge[]>([]);
  const [cliBadge, setCliBadge] = useState<CliBadge | null>(null);

  const addBadge = useCallback((incoming: CommandBadge) => {
    setBadges((prev) => {
      // Non-skill badges (slash/codepilot/sdk commands) replace — "run /clear
      // AND /help" isn't a meaningful action.
      if (incoming.kind !== 'agent_skill') {
        return [incoming];
      }
      // For skills: if any existing badge is non-skill kind, replace.
      // Otherwise append, de-duplicating by command.
      const allSkills = prev.every((b) => b.kind === 'agent_skill');
      if (!allSkills) return [incoming];
      if (prev.some((b) => b.command === incoming.command)) return prev;
      return [...prev, incoming];
    });
  }, []);

  const removeBadge = useCallback(
    (command: string) => {
      setBadges((prev) => prev.filter((b) => b.command !== command));
      setTimeout(() => textareaRef.current?.focus(), 0);
    },
    [textareaRef],
  );

  const clearBadges = useCallback(() => {
    setBadges([]);
  }, []);

  const removeCliBadge = useCallback(() => {
    setCliBadge(null);
    setTimeout(() => textareaRef.current?.focus(), 0);
  }, [textareaRef]);

  return {
    badges,
    addBadge,
    removeBadge,
    clearBadges,
    cliBadge,
    setCliBadge,
    removeCliBadge,
    hasBadge: badges.length > 0 || !!cliBadge,
  };
}
