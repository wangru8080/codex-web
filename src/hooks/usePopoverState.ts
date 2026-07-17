import { useRef, useState, useCallback, useEffect, useMemo } from 'react';
import type { PopoverItem, PopoverMode } from '@/types';
import { filterItems } from '@/lib/message-input-logic';

export interface UsePopoverStateReturn {
  popoverMode: PopoverMode;
  setPopoverMode: (mode: PopoverMode) => void;
  popoverItems: PopoverItem[];
  setPopoverItems: (items: PopoverItem[]) => void;
  popoverFilter: string;
  setPopoverFilter: (filter: string) => void;
  selectedIndex: number;
  setSelectedIndex: React.Dispatch<React.SetStateAction<number>>;
  triggerPos: number | null;
  setTriggerPos: (pos: number | null) => void;
  filteredItems: PopoverItem[];
  allDisplayedItems: PopoverItem[];
  aiSuggestions: PopoverItem[];
  aiSearchLoading: boolean;
  closePopover: () => void;
  popoverRef: React.RefObject<HTMLDivElement | null>;
}

export function usePopoverState(_modelName?: string): UsePopoverStateReturn {
  const popoverRef = useRef<HTMLDivElement>(null);
  const [popoverMode, setPopoverMode] = useState<PopoverMode>(null);
  const [popoverItems, setPopoverItems] = useState<PopoverItem[]>([]);
  const [popoverFilter, setPopoverFilter] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [triggerPos, setTriggerPos] = useState<number | null>(null);
  const [aiSuggestions, setAiSuggestions] = useState<PopoverItem[]>([]);
  const [aiSearchLoading, setAiSearchLoading] = useState(false);

  const closePopover = useCallback(() => {
    setPopoverMode(null);
    setPopoverItems([]);
    setPopoverFilter('');
    setSelectedIndex(0);
    setTriggerPos(null);
    setAiSuggestions([]);
    setAiSearchLoading(false);
  }, []);

  const filteredItems = useMemo(() =>
    filterItems(popoverItems, popoverFilter),
  [popoverItems, popoverFilter]);

  // Combined list for keyboard navigation
  const allDisplayedItems = useMemo(
    () => [...filteredItems, ...aiSuggestions],
    [filteredItems, aiSuggestions],
  );

  // Click outside to close popover
  useEffect(() => {
    if (!popoverMode) return;
    const handler = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        closePopover();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [popoverMode, closePopover]);

  return {
    popoverMode,
    setPopoverMode,
    popoverItems,
    setPopoverItems,
    popoverFilter,
    setPopoverFilter,
    selectedIndex,
    setSelectedIndex,
    triggerPos,
    setTriggerPos,
    filteredItems,
    allDisplayedItems,
    aiSuggestions,
    aiSearchLoading,
    closePopover,
    popoverRef,
  };
}
