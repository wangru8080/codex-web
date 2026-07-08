import { useTheme } from 'next-themes';
import { useThemeFamily } from '@/lib/theme/context';

export function useAppTheme() {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const { family, setFamily, families } = useThemeFamily();

  return {
    mode: theme,
    setMode: setTheme,
    resolvedMode: resolvedTheme,
    family,
    setFamily,
    families,
  };
}
