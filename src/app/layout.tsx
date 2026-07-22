import type { Metadata } from "next";
import "./globals.css";
import { ThemeProvider } from "@/components/layout/ThemeProvider";
import { ThemeFamilyProvider } from "@/components/layout/ThemeFamilyProvider";
import { I18nProvider } from "@/components/layout/I18nProvider";
import { IconProvider } from "@/components/layout/IconProvider";
import { RootAppContent } from "@/components/layout/RootAppContent";
import { getAllThemeFamilies, getThemeFamilyMetas } from "@/lib/theme/loader";
import { renderThemeFamilyCSS } from "@/lib/theme/render-css";

export const metadata: Metadata = {
  title: "CodexWeb",
  description: "A multi-model AI agent desktop client",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const families = getAllThemeFamilies();
  const familiesMeta = getThemeFamilyMetas();
  const themeFamilyCSS = renderThemeFamilyCSS(families);
  const validIds = families.map((f) => f.id);

  // 前端 1:1 展示版不读取 SQLite，只保留原始主题脚本和 localStorage 回退。
  const dbThemeMode: string | undefined = undefined;
  const dbThemeFamily: string | undefined = undefined;

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Anti-FOUC: stamp `data-platform` + `data-shell` +
            `data-platform-style` on <html> before hydration so
            platform-scoped CSS (the `--platform-*` token layer) lands
            on first paint.
            Round 17 (2026-05-23) — Codex P1 fix: separated OS
            detection from shell detection. The previous script set
            `data-platform="darwin"` for *any* macOS UA (Playwright,
            plain Safari, CDP smoke), which then activated Electron-
            only treatments (body transparency, traffic-light safe
            area). Now:
              - data-platform = darwin|win32|linux|web  → OS
              - data-shell    = electron|web            → host shell
            macOS-material CSS now scopes on both:
              html[data-platform="darwin"][data-shell="electron"]
                  [data-platform-style="auto"]
            so a regular browser staying on macOS still gets the
            standard product look. */}
        <script dangerouslySetInnerHTML={{ __html: `(function(){try{var ua=navigator.userAgent||'';var uaIsElectron=/Electron\\//.test(ua);var api=window.electronAPI&&window.electronAPI.versions&&window.electronAPI.versions.platform;var isElectron=!!api||uaIsElectron;var p='web';if(api)p=api;else if(/Mac/i.test(ua))p='darwin';else if(/Win/i.test(ua))p='win32';else if(/Linux/i.test(ua))p='linux';document.documentElement.setAttribute('data-platform',p);document.documentElement.setAttribute('data-shell',isElectron?'electron':'web');if(!document.documentElement.hasAttribute('data-platform-style')){document.documentElement.setAttribute('data-platform-style','auto')}}catch(e){}})();` }} />
        {/* Anti-FOUC: set data-theme-family from localStorage → DB fallback, validate against known IDs */}
        <script dangerouslySetInnerHTML={{ __html: `(function(){try{var v=${JSON.stringify(validIds)};var db=${JSON.stringify(dbThemeFamily || null)};var f=localStorage.getItem('codepilot_theme_family')||db||'default';if(v.indexOf(f)<0)f='default';document.documentElement.setAttribute('data-theme-family',f);if(!localStorage.getItem('codepilot_theme_family')&&f!=='default'){localStorage.setItem('codepilot_theme_family',f)}}catch(e){}})();` }} />
        {/* Sync DB theme mode to next-themes localStorage if not yet set */}
        {dbThemeMode && (
          <script dangerouslySetInnerHTML={{ __html: `(function(){try{if(!localStorage.getItem('theme')){localStorage.setItem('theme',${JSON.stringify(dbThemeMode)})}}catch(e){}})();` }} />
        )}
        <style id="theme-family-vars" dangerouslySetInnerHTML={{ __html: themeFamilyCSS }} />
      </head>
      <body className="antialiased">
        <ThemeProvider>
          <ThemeFamilyProvider families={familiesMeta}>
            <I18nProvider>
              <IconProvider>
                <RootAppContent>{children}</RootAppContent>
              </IconProvider>
            </I18nProvider>
          </ThemeFamilyProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
