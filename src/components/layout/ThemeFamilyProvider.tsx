"use client";

import { useState, useCallback, useEffect, type ReactNode } from 'react';
import { ThemeFamilyContext } from '@/lib/theme/context';
import type { ThemeFamilyMeta } from '@/lib/theme/types';

const STORAGE_KEY = 'codepilot_theme_family';

function getInitialFamily(): string {
  // Read from DOM attribute (set by anti-FOUC script before hydration)
  if (typeof document !== 'undefined') {
    return document.documentElement.dataset.themeFamily || 'default';
  }
  return 'default';
}

interface ThemeFamilyProviderProps {
  families: ThemeFamilyMeta[];
  children: ReactNode;
}

export function ThemeFamilyProvider({ families, children }: ThemeFamilyProviderProps) {
  const [rawFamily, setFamilyState] = useState(getInitialFamily);

  // Derive validated family: if stored ID no longer exists in loaded themes, use 'default'.
  const isValid = families.length === 0 || families.some((f) => f.id === rawFamily);
  const family = isValid ? rawFamily : 'default';

  // When the derived family differs from raw (i.e. fallback occurred),
  // sync DOM attribute and localStorage. This effect does NOT call setState,
  // avoiding the cascading-render lint error.
  useEffect(() => {
    if (family !== rawFamily) {
      document.documentElement.setAttribute('data-theme-family', family);
      try {
        localStorage.setItem(STORAGE_KEY, family);
      } catch {
        // localStorage may be unavailable
      }
    }
  }, [family, rawFamily]);

  const setFamily = useCallback((id: string) => {
    setFamilyState(id);
    // Sync to DOM immediately for instant visual update
    document.documentElement.setAttribute('data-theme-family', id);
    // Persist to localStorage (sole source of truth for theme family)
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch {
      // localStorage may be unavailable
    }
  }, []);

  return (
    <ThemeFamilyContext.Provider value={{ family, setFamily, families }}>
      {children}
    </ThemeFamilyContext.Provider>
  );
}
