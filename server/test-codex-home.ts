export const defaultTestCodexHome = "/volume2/SSD/codex/Temp/codex-dev-home";

export function resolveTestCodexHome(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): string {
  return env.CODEX_HOME?.trim() || defaultTestCodexHome;
}
