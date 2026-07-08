import fs from 'fs';
import path from 'path';
import type { ThemeFamily, ThemeFamilyMeta, ThemeColors } from './types';

/** Hardcoded fallback matching globals.css :root values. */
const FALLBACK_LIGHT: ThemeColors = {
  background: 'oklch(1 0 0)',
  foreground: 'oklch(0.147 0.004 49.25)',
  card: 'oklch(1 0 0)',
  cardForeground: 'oklch(0.147 0.004 49.25)',
  popover: 'oklch(1 0 0)',
  popoverForeground: 'oklch(0.147 0.004 49.25)',
  primary: 'oklch(0.262 0 0)',
  primaryForeground: 'oklch(0.985 0.001 106.423)',
  secondary: 'oklch(0.95 0.002 106.424)',
  secondaryForeground: 'oklch(0.216 0.006 56.043)',
  muted: 'oklch(0.95 0.002 106.424)',
  mutedForeground: 'oklch(0.553 0.013 58.071)',
  accent: 'oklch(0.95 0.002 106.424)',
  accentForeground: 'oklch(0.216 0.006 56.043)',
  destructive: 'oklch(0.577 0.245 27.325)',
  border: 'oklch(0.923 0.003 48.717)',
  input: 'oklch(0.923 0.003 48.717)',
  ring: 'oklch(0.262 0 0)',
  chart1: 'oklch(0.546 0.245 262.881)',
  chart2: 'oklch(0.6 0.118 184.704)',
  chart3: 'oklch(0.398 0.07 227.392)',
  chart4: 'oklch(0.828 0.189 84.429)',
  chart5: 'oklch(0.769 0.188 70.08)',
  sidebar: 'oklch(0.985 0.001 106.423)',
  sidebarForeground: 'oklch(0.147 0.004 49.25)',
  sidebarPrimary: 'oklch(0.262 0 0)',
  sidebarPrimaryForeground: 'oklch(0.985 0.001 106.423)',
  sidebarAccent: 'oklch(0.95 0.002 106.424)',
  sidebarAccentForeground: 'oklch(0.216 0.006 56.043)',
  sidebarBorder: 'oklch(0.923 0.003 48.717)',
  sidebarRing: 'oklch(0.262 0 0)',
};

const FALLBACK_DARK: ThemeColors = {
  background: 'oklch(0.147 0.004 49.25)',
  foreground: 'oklch(0.985 0.001 106.423)',
  card: 'oklch(0.216 0.006 56.043)',
  cardForeground: 'oklch(0.985 0.001 106.423)',
  popover: 'oklch(0.216 0.006 56.043)',
  popoverForeground: 'oklch(0.985 0.001 106.423)',
  primary: 'oklch(0.985 0.001 106.423)',
  primaryForeground: 'oklch(0.262 0 0)',
  secondary: 'oklch(0.268 0.007 34.298)',
  secondaryForeground: 'oklch(0.985 0.001 106.423)',
  muted: 'oklch(0.268 0.007 34.298)',
  mutedForeground: 'oklch(0.709 0.01 56.259)',
  accent: 'oklch(0.268 0.007 34.298)',
  accentForeground: 'oklch(0.985 0.001 106.423)',
  destructive: 'oklch(0.704 0.191 22.216)',
  border: 'oklch(1 0 0 / 10%)',
  input: 'oklch(1 0 0 / 15%)',
  ring: 'oklch(0.985 0.001 106.423)',
  chart1: 'oklch(0.623 0.214 259.815)',
  chart2: 'oklch(0.696 0.17 162.48)',
  chart3: 'oklch(0.769 0.188 70.08)',
  chart4: 'oklch(0.627 0.265 303.9)',
  chart5: 'oklch(0.645 0.246 16.439)',
  sidebar: 'oklch(0.216 0.006 56.043)',
  sidebarForeground: 'oklch(0.985 0.001 106.423)',
  sidebarPrimary: 'oklch(0.985 0.001 106.423)',
  sidebarPrimaryForeground: 'oklch(0.262 0 0)',
  sidebarAccent: 'oklch(0.268 0.007 34.298)',
  sidebarAccentForeground: 'oklch(0.985 0.001 106.423)',
  sidebarBorder: 'oklch(1 0 0 / 10%)',
  sidebarRing: 'oklch(0.985 0.001 106.423)',
};

/** Every key in ThemeColors is required — must match types.ts exactly. */
const REQUIRED_COLOR_KEYS: (keyof ThemeColors)[] = [
  'background', 'foreground', 'card', 'cardForeground',
  'popover', 'popoverForeground', 'primary', 'primaryForeground',
  'secondary', 'secondaryForeground', 'muted', 'mutedForeground',
  'accent', 'accentForeground', 'destructive', 'border', 'input', 'ring',
  'chart1', 'chart2', 'chart3', 'chart4', 'chart5',
  'sidebar', 'sidebarForeground', 'sidebarPrimary', 'sidebarPrimaryForeground',
  'sidebarAccent', 'sidebarAccentForeground', 'sidebarBorder', 'sidebarRing',
];

function isValidThemeColors(obj: unknown): obj is ThemeColors {
  if (!obj || typeof obj !== 'object') return false;
  const record = obj as Record<string, unknown>;
  return REQUIRED_COLOR_KEYS.every(
    (key) => typeof record[key] === 'string' && record[key] !== ''
  );
}

/** Check whether a value is a valid { light: string, dark: string } mapping. */
function isValidCodeThemeMapping(obj: unknown): boolean {
  if (!obj || typeof obj !== 'object') return false;
  const rec = obj as Record<string, unknown>;
  return typeof rec.light === 'string' && rec.light !== '' &&
         typeof rec.dark === 'string' && rec.dark !== '';
}

function isValidThemeFamily(obj: unknown): obj is ThemeFamily {
  if (!obj || typeof obj !== 'object') return false;
  const record = obj as Record<string, unknown>;
  return (
    typeof record.id === 'string' &&
    typeof record.label === 'string' &&
    typeof record.order === 'number' &&
    isValidThemeColors(record.light) &&
    isValidThemeColors(record.dark)
  );
}

/**
 * Strip invalid codeTheme / shikiTheme from a loaded theme.
 * This way a bad mapping doesn't break the whole theme; consumers fall back to defaults.
 */
function sanitizeThemeMappings(theme: ThemeFamily): void {
  if (theme.codeTheme !== undefined && !isValidCodeThemeMapping(theme.codeTheme)) {
    console.warn(`[theme-loader] Stripping invalid codeTheme from theme "${theme.id}"`);
    delete theme.codeTheme;
  }
  if (theme.shikiTheme !== undefined && !isValidCodeThemeMapping(theme.shikiTheme)) {
    console.warn(`[theme-loader] Stripping invalid shikiTheme from theme "${theme.id}"`);
    delete theme.shikiTheme;
  }
}

/** Resolve the themes directory. Works for both dev and Electron packaged app. */
function resolveThemesDir(): string {
  // In Electron packaged app, process.resourcesPath points to resources/
  // and themes are at standalone/themes/ inside resources.
  const electronPath = process.env.RESOURCES_PATH
    ? path.join(process.env.RESOURCES_PATH, 'standalone', 'themes')
    : null;

  const devPath = path.resolve(process.cwd(), 'themes');

  if (electronPath && fs.existsSync(electronPath)) return electronPath;
  return devPath;
}

// Module-level cache (runs once per process)
let cachedFamilies: ThemeFamily[] | null = null;

/** Reset the module-level cache. Test-only. */
export function _resetCache() {
  cachedFamilies = null;
}

/** Load and validate all theme families from themes/*.json. */
export function getAllThemeFamilies(): ThemeFamily[] {
  if (cachedFamilies) return cachedFamilies;

  const themesDir = resolveThemesDir();
  const families: ThemeFamily[] = [];

  try {
    if (!fs.existsSync(themesDir)) {
      console.warn(`[theme-loader] Themes directory not found: ${themesDir}`);
    } else {
      const files = fs.readdirSync(themesDir).filter((f) => f.endsWith('.json'));

      for (const file of files) {
        try {
          const raw = fs.readFileSync(path.join(themesDir, file), 'utf-8');
          const parsed = JSON.parse(raw);

          if (isValidThemeFamily(parsed)) {
            sanitizeThemeMappings(parsed);
            families.push(parsed);
          } else {
            console.warn(`[theme-loader] Skipping invalid theme file: ${file}`);
          }
        } catch (err) {
          console.warn(`[theme-loader] Failed to parse ${file}:`, err);
        }
      }
    }
  } catch (err) {
    console.warn('[theme-loader] Error reading themes directory:', err);
  }

  // Ensure a default family always exists
  if (!families.some((f) => f.id === 'default')) {
    families.push({
      id: 'default',
      label: 'Default',
      order: 0,
      light: FALLBACK_LIGHT,
      dark: FALLBACK_DARK,
    });
  }

  families.sort((a, b) => a.order - b.order);
  cachedFamilies = families;
  return families;
}

/** Lightweight metadata for client-side use. */
export function getThemeFamilyMetas(): ThemeFamilyMeta[] {
  return getAllThemeFamilies().map((f) => ({
    id: f.id,
    label: f.label,
    description: f.description,
    previewColors: {
      primaryLight: f.light.primary,
      primaryDark: f.dark.primary,
      accentLight: f.light.accent,
      backgroundLight: f.light.background,
    },
    codeTheme: f.codeTheme,
    shikiTheme: f.shikiTheme,
  }));
}
