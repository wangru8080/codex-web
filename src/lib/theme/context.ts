import { createContext, useContext } from 'react';
import type { ThemeFamilyMeta } from './types';

export interface ThemeFamilyContextValue {
  family: string;
  setFamily: (id: string) => void;
  families: ThemeFamilyMeta[];
}

export const ThemeFamilyContext = createContext<ThemeFamilyContextValue>({
  family: 'default',
  setFamily: () => {},
  families: [],
});

export function useThemeFamily() {
  return useContext(ThemeFamilyContext);
}
