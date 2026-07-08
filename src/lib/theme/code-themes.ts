/**
 * Centralized code theme mappings for Prism, HLJS, and Shiki.
 *
 * Each theme family JSON can specify `codeTheme: { light, dark }` and
 * `shikiTheme: { light, dark }` using the keys defined below.
 * Components should use the hooks exported here rather than maintaining
 * local maps.
 */

import type { CSSProperties } from 'react';
import type { BundledTheme } from 'shiki';

// ── Prism (react-syntax-highlighter/prism) ──────────────────────────────
import {
  oneDark,
  oneLight,
  vscDarkPlus,
  nord as nordPrism,
  solarizedDarkAtom,
  solarizedlight as solarizedLightPrism,
  nightOwl as nightOwlPrism,
  dracula as draculaPrism,
  gruvboxDark as gruvboxDarkPrism,
  gruvboxLight as gruvboxLightPrism,
  ghcolors,
  synthwave84 as synthwave84Prism,
  materialDark as materialDarkPrism,
  materialOceanic as materialOceanicPrism,
  duotoneSea as duotoneSeaPrism,
  coldarkDark as coldarkDarkPrism,
  coldarkCold as coldarkColdPrism,
  materialLight as materialLightPrism,
  duotoneLight as duotoneLightPrism,
  vs as vsPrism,
  coy as coyPrism,
  prism as prismDefault,
  duotoneEarth as duotoneEarthPrism,
  duotoneForest as duotoneForestPrism,
  twilight as twilightPrism,
} from 'react-syntax-highlighter/dist/esm/styles/prism';

type SyntaxStyle = Record<string, CSSProperties>;

/** Prism theme name → style object. Keys match `codeTheme.dark` / `codeTheme.light` in theme JSONs. */
export const PRISM_THEME_MAP: Record<string, SyntaxStyle> = {
  oneDark,
  oneLight,
  vscDarkPlus,
  nord: nordPrism,
  solarizedDarkAtom,
  solarizedlight: solarizedLightPrism,
  nightOwl: nightOwlPrism,
  dracula: draculaPrism,
  gruvboxDark: gruvboxDarkPrism,
  gruvboxLight: gruvboxLightPrism,
  ghcolors,
  synthwave84: synthwave84Prism,
  materialDark: materialDarkPrism,
  materialOceanic: materialOceanicPrism,
  duotoneSea: duotoneSeaPrism,
  coldarkDark: coldarkDarkPrism,
  coldarkCold: coldarkColdPrism,
  materialLight: materialLightPrism,
  duotoneLight: duotoneLightPrism,
  vs: vsPrism,
  coy: coyPrism,
  prism: prismDefault,
  duotoneEarth: duotoneEarthPrism,
  duotoneForest: duotoneForestPrism,
  twilight: twilightPrism,
};

export const PRISM_DEFAULT_DARK: SyntaxStyle = oneDark;
export const PRISM_DEFAULT_LIGHT: SyntaxStyle = oneLight;

// ── HLJS (react-syntax-highlighter/hljs) ────────────────────────────────
import {
  atomOneDark,
  atomOneLight,
  nord as nordHljs,
  solarizedDark,
  solarizedLight,
  nightOwl as nightOwlHljs,
  dracula as draculaHljs,
  gruvboxDark as gruvboxDarkHljs,
  gruvboxLight as gruvboxLightHljs,
  github as githubHljs,
  vs2015 as vs2015Hljs,
  monokaiSublime as monokaiSublimeHljs,
  vs as vsHljs,
  idea as ideaHljs,
  lightfair as lightfairHljs,
  xcode as xcodeHljs,
  zenburn as zenburnHljs,
  darcula as darculaHljs,
  obsidian as obsidianHljs,
} from 'react-syntax-highlighter/dist/esm/styles/hljs';

type HljsStyle = Record<string, CSSProperties>;

/** HLJS theme name → style object. Same keys as Prism map where possible. */
export const HLJS_THEME_MAP: Record<string, HljsStyle> = {
  oneDark: atomOneDark,
  oneLight: atomOneLight,
  nord: nordHljs,
  solarizedDarkAtom: solarizedDark,
  solarizedlight: solarizedLight,
  nightOwl: nightOwlHljs,
  dracula: draculaHljs,
  gruvboxDark: gruvboxDarkHljs,
  gruvboxLight: gruvboxLightHljs,
  ghcolors: githubHljs,
  synthwave84: monokaiSublimeHljs,
  materialDark: vs2015Hljs,
  materialOceanic: atomOneDark,
  duotoneSea: atomOneDark,
  coldarkDark: atomOneDark,
  coldarkCold: atomOneLight,
  materialLight: ideaHljs,
  duotoneLight: atomOneLight,
  vs: vsHljs,
  coy: xcodeHljs,
  prism: lightfairHljs,
  duotoneEarth: darculaHljs,
  duotoneForest: zenburnHljs,
  twilight: obsidianHljs,
};

export const HLJS_DEFAULT_DARK: HljsStyle = atomOneDark;
export const HLJS_DEFAULT_LIGHT: HljsStyle = atomOneLight;

// ── Shiki ───────────────────────────────────────────────────────────────

export const SHIKI_DEFAULT_LIGHT: BundledTheme = 'github-light';
export const SHIKI_DEFAULT_DARK: BundledTheme = 'github-dark';

// ── Resolution helpers ──────────────────────────────────────────────────

import type { ThemeFamilyMeta, CodeThemeMapping } from './types';

/**
 * Resolve a code-theme mapping from the current family metadata.
 * Returns `undefined` if family has no `codeTheme`.
 */
export function resolveCodeTheme(
  families: ThemeFamilyMeta[],
  familyId: string,
): CodeThemeMapping | undefined {
  return families.find((f) => f.id === familyId)?.codeTheme;
}

/**
 * Resolve a shiki-theme mapping from the current family metadata.
 * Returns `undefined` if family has no `shikiTheme`.
 */
export function resolveShikiTheme(
  families: ThemeFamilyMeta[],
  familyId: string,
): CodeThemeMapping | undefined {
  return families.find((f) => f.id === familyId)?.shikiTheme;
}

/** Pick a Prism style for the given mode. Falls back to oneDark / oneLight. */
export function resolvePrismStyle(
  codeTheme: CodeThemeMapping | undefined,
  isDark: boolean,
): SyntaxStyle {
  const name = isDark ? codeTheme?.dark : codeTheme?.light;
  if (name && PRISM_THEME_MAP[name]) return PRISM_THEME_MAP[name];
  return isDark ? PRISM_DEFAULT_DARK : PRISM_DEFAULT_LIGHT;
}

/** Pick an HLJS style for the given mode. Falls back to atomOneDark / atomOneLight. */
export function resolveHljsStyle(
  codeTheme: CodeThemeMapping | undefined,
  isDark: boolean,
): HljsStyle {
  const name = isDark ? codeTheme?.dark : codeTheme?.light;
  if (name && HLJS_THEME_MAP[name]) return HLJS_THEME_MAP[name];
  return isDark ? HLJS_DEFAULT_DARK : HLJS_DEFAULT_LIGHT;
}

/** Pick a Shiki BundledTheme pair. Falls back to github-light / github-dark. */
export function resolveShikiThemes(
  shikiTheme: CodeThemeMapping | undefined,
): { light: BundledTheme; dark: BundledTheme } {
  return {
    light: (shikiTheme?.light ?? SHIKI_DEFAULT_LIGHT) as BundledTheme,
    dark: (shikiTheme?.dark ?? SHIKI_DEFAULT_DARK) as BundledTheme,
  };
}
