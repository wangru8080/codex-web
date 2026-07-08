/**
 * Theme Family system types.
 *
 * A "theme family" controls the color palette independently of light/dark mode.
 * Mode is handled by next-themes; family is a second layer via CSS variables.
 */

/** All CSS variable keys matching globals.css :root block (camelCase). */
export interface ThemeColors {
  background: string;
  foreground: string;
  card: string;
  cardForeground: string;
  popover: string;
  popoverForeground: string;
  primary: string;
  primaryForeground: string;
  secondary: string;
  secondaryForeground: string;
  muted: string;
  mutedForeground: string;
  accent: string;
  accentForeground: string;
  destructive: string;
  border: string;
  input: string;
  ring: string;
  chart1: string;
  chart2: string;
  chart3: string;
  chart4: string;
  chart5: string;
  sidebar: string;
  sidebarForeground: string;
  sidebarPrimary: string;
  sidebarPrimaryForeground: string;
  sidebarAccent: string;
  sidebarAccentForeground: string;
  sidebarBorder: string;
  sidebarRing: string;
}

/** Maps a code highlighting theme name for light and dark modes. */
export interface CodeThemeMapping {
  light: string;
  dark: string;
}

/** Full theme family definition (loaded from JSON). */
export interface ThemeFamily {
  id: string;
  label: string;
  order: number;
  description?: string;
  light: ThemeColors;
  dark: ThemeColors;
  codeTheme?: CodeThemeMapping;
  /** Shiki theme names (used by ai-elements code blocks). */
  shikiTheme?: CodeThemeMapping;
}

/** Lightweight metadata for client-side use (selector UI). */
export interface ThemeFamilyMeta {
  id: string;
  label: string;
  description?: string;
  /** Preview colors for the selector (primary light, primary dark, accent light, background light). */
  previewColors?: {
    primaryLight: string;
    primaryDark: string;
    accentLight: string;
    backgroundLight: string;
  };
  /** Code highlighting theme names (keys into react-syntax-highlighter theme maps). */
  codeTheme?: CodeThemeMapping;
  /** Shiki theme names for ai-elements code blocks. */
  shikiTheme?: CodeThemeMapping;
}
