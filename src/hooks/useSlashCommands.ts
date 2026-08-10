import { useCallback, useMemo, useRef } from 'react';
import type { PopoverItem, PopoverMode, SkillKind } from '@/types';
import { detectPopoverTrigger, resolveItemSelection } from '@/lib/message-input-logic';
import { BUILT_IN_COMMANDS, COMMAND_PROMPTS } from '@/lib/constants/commands';
import { COMMAND_ICON_NAMES } from '@/lib/constants/command-icons';
import { useAppServerActions } from '@/codex-web/AppServerProvider';
import { getPluginIconUrl } from '@/lib/media-resource-cache';

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
  addBadge: (badge: { command: string; label: string; description: string; kind: SkillKind; installedSource?: "agents" | "claude"; skillPath?: string; pluginUri?: string; pluginIconUrl?: string | null }) => void;
  onMentionInserted?: (mention: { path: string; nodeType: 'file' | 'directory'; display: string }) => void;
  onFileReferenceSelected?: (reference: { path: string; display: string }) => void;
  /** When true, block immediate commands and badge selection from popover */
  isStreaming?: boolean;
}): UseSlashCommandsReturn {
  const {
    workingDirectory,
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
    onFileReferenceSelected,
    isStreaming,
} = opts;
  const { listSkills, fuzzyFileSearch, listInstalledPlugins, readFile } = useAppServerActions();
  const searchSequenceRef = useRef(0);

  // Enrich built-in commands with icons (presentation layer enrichment)
  const enrichedBuiltIns = useMemo(
    () => BUILT_IN_COMMANDS.map(cmd => ({ ...cmd, iconName: COMMAND_ICON_NAMES[cmd.value] })),
    [],
  );

  // Fetch files for @ mention
  const fetchFiles = useCallback(async (filter: string) => {
    const query = filter.trim();
    if (!query || !workingDirectory) return [];
    try {
      const response = await fuzzyFileSearch({
        query,
        roots: [workingDirectory],
        cancellationToken: null,
      });
      return response.files.slice(0, 50).map((item) => ({
        label: item.file_name,
        value: item.path,
        display: item.path,
        description: item.path === item.file_name ? undefined : item.path.slice(0, -(item.file_name.length + 1)),
        nodeType: item.match_type,
      }));
    } catch {
      return [];
    }
  }, [workingDirectory, fuzzyFileSearch]);

  const fetchPlugins = useCallback(async () => {
    try {
      const response = await listInstalledPlugins(workingDirectory ? { cwds: [workingDirectory] } : {});
      return Promise.all(response.marketplaces.flatMap((marketplace) => marketplace.plugins.map((plugin) => ({ marketplace, plugin })))
        .filter(({ plugin }) => plugin.installed && plugin.enabled)
        .map(async ({ marketplace, plugin }) => ({
          label: plugin.interface?.displayName || plugin.name,
          value: plugin.name,
          description: plugin.interface?.shortDescription || undefined,
          kind: 'plugin' as const,
          source: 'plugin' as const,
          pluginUri: `plugin://${plugin.name}@${marketplace.name}/`,
          pluginIconUrl: await getPluginIconUrl(plugin.interface, readFile),
        })));
    } catch {
      return [];
    }
  }, [listInstalledPlugins, readFile, workingDirectory]);

  // Fetch enabled skills for the $ picker from app-server.
  const fetchSkills = useCallback(async () => {
    let apiSkills: PopoverItem[] = [];
    try {
      const response = await listSkills({
        ...(workingDirectory ? { cwds: [workingDirectory] } : {}),
        forceReload: false,
      });
      const unique = new Map(response.data.flatMap((entry) => entry.skills).map((skill) => [skill.path, skill]));
      apiSkills = [...unique.values()]
        .filter((skill) => skill.enabled)
        .map((skill) => ({
          label: skill.interface?.displayName || skill.name,
          value: `/${skill.name}`,
          description: skill.interface?.shortDescription || skill.shortDescription || skill.description,
          builtIn: false,
          source: skill.scope === 'user' ? 'global' : skill.scope === 'repo' ? 'project' : 'sdk',
          kind: 'agent_skill',
          skillPath: skill.path,
        }));
    } catch {
      // API not available - just use built-in commands
    }

    return apiSkills;
  }, [workingDirectory, listSkills]);

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

      case 'select_file_reference':
        setInputValue(result.newInputValue ?? '');
        if (result.reference) {
          onFileReferenceSelected?.({
            path: result.reference.path,
            display: result.reference.display,
          });
        }
        closePopover();
        setTimeout(() => textareaRef.current?.focus(), 0);
        return;
    }
  }, [triggerPos, popoverMode, closePopover, onCommand, inputValue, popoverFilter, textareaRef, setInputValue, addBadge, onMentionInserted, onFileReferenceSelected, isStreaming]);

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
        const sequence = ++searchSequenceRef.current;
        const [files, plugins] = await Promise.all([fetchFiles(trigger.filter), fetchPlugins()]);
        const filterLower = trigger.filter.toLowerCase();
        const matchingPlugins = plugins.filter((item) => item.label.toLowerCase().includes(filterLower));
        if (sequence === searchSequenceRef.current) setPopoverItems([...files, ...matchingPlugins]);
      } else if (trigger.mode === 'skill') {
        const sequence = ++searchSequenceRef.current;
        const items = await fetchSkills();
        if (sequence === searchSequenceRef.current) setPopoverItems(items);
      } else {
        searchSequenceRef.current += 1;
        setPopoverItems(enrichedBuiltIns);
      }
      return;
    }

    // Only auto-close text-triggered popovers (file/skill); CLI is button-triggered
    if (popoverMode && popoverMode !== 'cli') {
      searchSequenceRef.current += 1;
      closePopover();
    }
  }, [fetchFiles, fetchPlugins, fetchSkills, enrichedBuiltIns, popoverMode, closePopover, textareaRef, setInputValue, setPopoverMode, setPopoverFilter, setTriggerPos, setSelectedIndex, setPopoverItems]);

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
