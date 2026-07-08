import { useCallback, useMemo } from 'react';
import type { PopoverItem, PopoverMode, SkillKind } from '@/types';
import { detectPopoverTrigger, resolveItemSelection } from '@/lib/message-input-logic';
import { BUILT_IN_COMMANDS, COMMAND_PROMPTS } from '@/lib/constants/commands';
import { COMMAND_ICON_NAMES } from '@/lib/constants/command-icons';

// Re-export for backward compatibility
export { BUILT_IN_COMMANDS, COMMAND_PROMPTS };

export interface UseSlashCommandsReturn {
  fetchFiles: (filter: string) => Promise<PopoverItem[]>;
  fetchSkills: () => Promise<PopoverItem[]>;
  insertItem: (item: PopoverItem) => void;
  handleInputChange: (val: string) => Promise<void>;
  handleInsertSlash: () => void;
}

export function useSlashCommands(opts: {
  sessionId?: string;
  workingDirectory?: string;
  sdkInitMeta?: { tools?: unknown; slash_commands?: unknown; skills?: unknown } | null;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  inputValue: string;
  setInputValue: (value: string) => void;
  popoverMode: PopoverMode;
  popoverFilter: string;
  triggerPos: number | null;
  setPopoverMode: (mode: PopoverMode) => void;
  setPopoverFilter: (filter: string) => void;
  setPopoverItems: (items: PopoverItem[]) => void;
  setSelectedIndex: React.Dispatch<React.SetStateAction<number>>;
  setTriggerPos: (pos: number | null) => void;
  closePopover: () => void;
  onCommand?: (command: string) => void;
  addBadge: (badge: { command: string; label: string; description: string; kind: SkillKind; installedSource?: "agents" | "claude" }) => void;
  onMentionInserted?: (mention: { path: string; nodeType: 'file' | 'directory'; display: string }) => void;
  /** When true, block immediate commands and badge selection from popover */
  isStreaming?: boolean;
}): UseSlashCommandsReturn {
  const {
    sessionId,
    workingDirectory,
    sdkInitMeta,
    textareaRef,
    inputValue,
    setInputValue,
    popoverMode,
    popoverFilter,
    triggerPos,
    setPopoverMode,
    setPopoverFilter,
    setPopoverItems,
    setSelectedIndex,
    setTriggerPos,
    closePopover,
    onCommand,
    addBadge,
    onMentionInserted,
    isStreaming,
  } = opts;

  // Enrich built-in commands with icons (presentation layer enrichment)
  const enrichedBuiltIns = useMemo(
    () => BUILT_IN_COMMANDS.map(cmd => ({ ...cmd, iconName: COMMAND_ICON_NAMES[cmd.value] })),
    [],
  );

  // Fetch files for @ mention
  const fetchFiles = useCallback(async (filter: string) => {
    try {
      const params = new URLSearchParams();
      if (sessionId) params.set('sessionId', sessionId);
      if (!sessionId && workingDirectory) params.set('workingDirectory', workingDirectory);
      if (filter) params.set('q', filter);
      params.set('limit', '50');
      const res = await fetch(`/api/files/suggest?${params.toString()}`);
      if (!res.ok) return [];
      const data = await res.json();
      const items = (data.items || []) as Array<{ path: string; display?: string; type?: 'file' | 'directory'; nodeType?: 'file' | 'directory' }>;
      return items.map((item) => ({
        label: item.display || item.path,
        value: item.path,
        display: item.display || item.path,
        nodeType: item.type || item.nodeType || 'file',
      }));
    } catch {
      return [];
    }
  }, [sessionId, workingDirectory]);

  // Fetch skills for / command (built-in + API)
  const fetchSkills = useCallback(async () => {
    let apiSkills: PopoverItem[] = [];
    try {
      const params = new URLSearchParams();
      if (workingDirectory) params.set('cwd', workingDirectory);
      if (sessionId) params.set('sessionId', sessionId);
      const qs = params.toString();
      const res = await fetch(`/api/skills${qs ? `?${qs}` : ''}`);
      if (res.ok) {
        const data = await res.json();
        const skills = data.skills || [];
        apiSkills = skills
          .filter((s: { source?: string; loaded?: boolean }) => {
            // Exclude plugin-source skills that are not loaded in the current session
            if (s.source === 'plugin' && s.loaded === false) return false;
            return true;
          })
          .map((s: { name: string; description: string; source?: "global" | "project" | "plugin" | "installed" | "sdk"; kind?: SkillKind; installedSource?: "agents" | "claude" }) => ({
            label: s.name,
            value: `/${s.name}`,
            description: s.description || "",
            builtIn: false,
            installedSource: s.installedSource,
            source: s.source,
            kind: s.kind || 'slash_command',
          }));
      }
    } catch {
      // API not available - just use built-in commands
    }

    // When SDK init metadata is available, use it as the truth source
    if (sdkInitMeta) {
      const rawCmds = sdkInitMeta.slash_commands;
      const rawSkills = sdkInitMeta.skills;
      const sdkCommandNames = new Set(
        Array.isArray(rawCmds) ? rawCmds.map(c => typeof c === 'string' ? c : (c as { name?: string })?.name).filter(Boolean) as string[] : []
      );
      const sdkSkillNames = new Set(
        Array.isArray(rawSkills) ? rawSkills.map(s => typeof s === 'string' ? s : (s as { name?: string })?.name).filter(Boolean) as string[] : []
      );

      // Only filter if SDK actually reported capabilities (non-empty arrays)
      if (sdkCommandNames.size > 0 || sdkSkillNames.size > 0) {
        apiSkills = apiSkills.filter(item => {
          if (item.kind === 'agent_skill') return sdkSkillNames.has(item.label);
          return sdkCommandNames.has(item.label);
        });
      }

      const existingNames = new Set(apiSkills.map(s => s.label));

      // Add SDK-reported commands not found in filesystem scan
      for (const cmdName of sdkCommandNames) {
        if (!existingNames.has(cmdName)) {
          apiSkills.push({
            label: cmdName,
            value: `/${cmdName}`,
            description: `SDK command: /${cmdName}`,
            builtIn: false,
            source: 'sdk',
            kind: 'sdk_command',
          });
        }
      }

      // Add SDK-reported skills not found in filesystem scan
      for (const skillName of sdkSkillNames) {
        if (!existingNames.has(skillName)) {
          apiSkills.push({
            label: skillName,
            value: `/${skillName}`,
            description: `Skill: /${skillName}`,
            builtIn: false,
            kind: 'agent_skill',
          });
        }
      }
    }

    // Deduplicate: remove API skills that share a name with built-in commands
    const builtInNames = new Set(enrichedBuiltIns.map(c => c.label));
    const uniqueSkills = apiSkills.filter(s => !builtInNames.has(s.label));

    return [...enrichedBuiltIns, ...uniqueSkills];
  }, [sessionId, workingDirectory, sdkInitMeta, enrichedBuiltIns]);

  // Insert selected item
  const insertItem = useCallback((item: PopoverItem) => {
    if (triggerPos === null) return;

    const result = resolveItemSelection(item, popoverMode, triggerPos, inputValue, popoverFilter);

    switch (result.action) {
      case 'immediate_command':
        // Block during streaming — destructive commands (e.g. /clear) would race
        if (isStreaming) { closePopover(); return; }
        if (onCommand) {
          setInputValue('');
          closePopover();
          onCommand(result.commandValue!);
        }
        return;

      case 'set_badge':
        // Block during streaming — badges dispatch as slash/skill prompts, not queueable
        if (isStreaming) { closePopover(); return; }
        addBadge(result.badge!);
        setInputValue(result.newInputValue ?? '');
        closePopover();
        setTimeout(() => {
          const el = textareaRef.current;
          if (!el) return;
          el.focus();
          const pos = el.value.length;
          el.setSelectionRange(pos, pos);
        }, 0);
        return;

      case 'insert_file_mention':
        setInputValue(result.newInputValue!);
        onMentionInserted?.({
          path: item.value,
          nodeType: item.nodeType || 'file',
          display: item.display || item.value,
        });
        closePopover();
        setTimeout(() => textareaRef.current?.focus(), 0);
        return;
    }
  }, [triggerPos, popoverMode, closePopover, onCommand, inputValue, popoverFilter, textareaRef, setInputValue, addBadge, onMentionInserted, isStreaming]);

  // Handle input changes to detect @ and /
  const handleInputChange = useCallback(async (val: string) => {
    setInputValue(val);

    const textarea = textareaRef.current;
    if (!textarea) return;

    const cursorPos = textarea.selectionStart;
    const trigger = detectPopoverTrigger(val, cursorPos);

    if (trigger) {
      setPopoverMode(trigger.mode!);
      setPopoverFilter(trigger.filter);
      setTriggerPos(trigger.triggerPos);
      setSelectedIndex(0);

      if (trigger.mode === 'file') {
        const items = await fetchFiles(trigger.filter);
        setPopoverItems(items);
      } else {
        const items = await fetchSkills();
        setPopoverItems(items);
      }
      return;
    }

    // Only auto-close text-triggered popovers (file/skill); CLI is button-triggered
    if (popoverMode && popoverMode !== 'cli') {
      closePopover();
    }
  }, [fetchFiles, fetchSkills, popoverMode, closePopover, textareaRef, setInputValue, setPopoverMode, setPopoverFilter, setTriggerPos, setSelectedIndex, setPopoverItems]);

  // Insert `/` into textarea to trigger slash command popover. When the
  // preceding char isn't whitespace, auto-prepend a space so the trigger regex
  // (which requires `^|\s` before `/`) matches — this is why the user can
  // click the slash button mid-word and still see the picker, without forcing
  // the regex to false-positive on path-like text.
  const handleInsertSlash = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const cursorPos = textarea.selectionStart;
    const before = inputValue.slice(0, cursorPos);
    const after = inputValue.slice(cursorPos);
    const needsSpace = before.length > 0 && !/\s$/.test(before);
    const inserted = needsSpace ? ' /' : '/';
    const newValue = before + inserted + after;
    const newCursorPos = cursorPos + inserted.length;
    setInputValue(newValue);
    // Set cursor position first so handleInputChange reads correct selectionStart
    textarea.value = newValue;
    textarea.selectionStart = newCursorPos;
    textarea.selectionEnd = newCursorPos;
    textarea.focus();
    handleInputChange(newValue);
  }, [inputValue, handleInputChange, textareaRef, setInputValue]);

  return {
    fetchFiles,
    fetchSkills,
    insertItem,
    handleInputChange,
    handleInsertSlash,
  };
}
