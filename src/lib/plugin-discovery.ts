/**
 * Plugin Discovery Layer — scans marketplace and external plugin directories,
 * reads plugin manifests, and provides enable/disable state that reads and writes
 * the official Claude `enabledPlugins` config.
 *
 * Enable state resolution reads user + project + local settings layers to match
 * the SDK's own `settingSources: ['user', 'project', 'local']` resolution.
 *
 * Write strategy:
 *   - Default target: user-level ~/.claude/settings.json (matches `claude plugin enable/disable`).
 *   - When a higher-priority layer (project or local) would override the user-level write
 *     and prevent the desired state from taking effect, the write is escalated to the
 *     local layer (.claude/settings.local.json in cwd) which has highest priority and
 *     is gitignored. This requires a cwd parameter.
 *
 * Plugin loading into SDK sessions is handled by the SDK itself —
 * CodexWeb does NOT explicitly inject plugins via queryOptions.plugins.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import type { PluginInfo } from '@/types';

// ==========================================
// Types
// ==========================================

interface PluginManifest {
  name: string;
  description?: string;
  author?: { name: string; url?: string };
  commands?: unknown;
  skills?: unknown;
  agents?: unknown;
}

interface BlocklistEntry {
  plugin: string; // "name@marketplace"
}

interface Blocklist {
  plugins: BlocklistEntry[];
}

interface DiscoveredPlugin {
  name: string;
  description: string;
  author?: { name: string; url?: string };
  path: string;
  marketplace: string;
  location: 'plugins' | 'external_plugins';
  hasCommands: boolean;
  hasSkills: boolean;
  hasAgents: boolean;
}

/**
 * enabledPlugins values can be:
 *   - boolean: simple enable/disable
 *   - string[]: version constraints (extended format)
 *
 * We treat any truthy non-false value as "enabled".
 */
type EnabledPluginsMap = Record<string, boolean | string[]>;

// ==========================================
// Cache (60s TTL)
// ==========================================

let cachedPlugins: DiscoveredPlugin[] | null = null;
let cachedBlocklist: Set<string> | null = null;
let cachedMergedEnabled: EnabledPluginsMap | null = null;
let cachedMergedCwd: string | null = null;
let cacheTimestamp = 0;
const CACHE_TTL = 60_000;

function isCacheValid(): boolean {
  return cachedPlugins !== null && Date.now() - cacheTimestamp < CACHE_TTL;
}

function invalidateCache(): void {
  cachedPlugins = null;
  cachedBlocklist = null;
  cachedMergedEnabled = null;
  cachedMergedCwd = null;
  cacheTimestamp = 0;
}

// ==========================================
// Settings file I/O
// ==========================================

function readJsonFile(filePath: string): Record<string, unknown> {
  if (!fs.existsSync(filePath)) return {};
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return {};
  }
}

function writeJsonFile(filePath: string, data: Record<string, unknown>): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

// ==========================================
// enabledPlugins — multi-layer resolution
// ==========================================

function getUserSettingsPath(): string {
  return path.join(os.homedir(), '.claude', 'settings.json');
}

function getProjectSettingsPath(cwd: string): string {
  return path.join(cwd, '.claude', 'settings.json');
}

function getLocalSettingsPath(cwd: string): string {
  return path.join(cwd, '.claude', 'settings.local.json');
}

/**
 * Extract enabledPlugins from a settings object, preserving original value types.
 */
function extractEnabledPlugins(settings: Record<string, unknown>): EnabledPluginsMap {
  const raw = settings.enabledPlugins;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as EnabledPluginsMap;
  }
  return {};
}

/**
 * Merge enabledPlugins across all setting layers.
 * Resolution order (later wins): user → project → local.
 * This mirrors the SDK's own settingSources cascade.
 */
export function readMergedEnabledPlugins(cwd?: string): EnabledPluginsMap {
  const effectiveCwd = cwd || process.cwd();
  if (cachedMergedEnabled !== null && cachedMergedCwd === effectiveCwd && isCacheValid()) {
    return cachedMergedEnabled;
  }

  const userEnabled = extractEnabledPlugins(readJsonFile(getUserSettingsPath()));
  const projectEnabled = extractEnabledPlugins(readJsonFile(getProjectSettingsPath(effectiveCwd)));
  const localEnabled = extractEnabledPlugins(readJsonFile(getLocalSettingsPath(effectiveCwd)));

  // Later layers override earlier ones (same key)
  const merged: EnabledPluginsMap = { ...userEnabled, ...projectEnabled, ...localEnabled };

  cachedMergedEnabled = merged;
  cachedMergedCwd = effectiveCwd;
  return merged;
}

/**
 * Write a single enabledPlugins entry to a specific settings file.
 * Only touches the target key — preserves all other settings and other plugin entries.
 */
function writeEnabledPluginEntry(
  settingsPath: string,
  pluginKey: string,
  value: boolean | string[],
): void {
  const settings = readJsonFile(settingsPath);
  const current = extractEnabledPlugins(settings);
  current[pluginKey] = value;
  settings.enabledPlugins = current;
  writeJsonFile(settingsPath, settings);
  cachedMergedEnabled = null; // bust cache
}

// ==========================================
// Blocklist
// ==========================================

function getBlocklistPath(): string {
  return path.join(os.homedir(), '.claude', 'plugins', 'blocklist.json');
}

export function readBlocklist(): Set<string> {
  if (cachedBlocklist !== null && isCacheValid()) return cachedBlocklist;

  const blocklistPath = getBlocklistPath();
  const blocked = new Set<string>();

  if (fs.existsSync(blocklistPath)) {
    try {
      const raw = fs.readFileSync(blocklistPath, 'utf-8');
      const data = JSON.parse(raw) as Blocklist;
      if (Array.isArray(data.plugins)) {
        for (const entry of data.plugins) {
          if (entry.plugin) {
            blocked.add(entry.plugin);
          }
        }
      }
    } catch {
      // ignore parse errors
    }
  }

  cachedBlocklist = blocked;
  return blocked;
}

// ==========================================
// Enable/disable resolution
// ==========================================

/**
 * Check if a value from enabledPlugins represents "enabled".
 * - `true` → enabled
 * - `string[]` (version constraints) → enabled (with constraints)
 * - `false` / absent → disabled
 */
function isEnabledValue(value: boolean | string[] | undefined): boolean {
  if (value === undefined || value === false) return false;
  if (value === true) return true;
  // string[] (version constraints) — treat as enabled
  if (Array.isArray(value)) return true;
  return false;
}

/**
 * Resolve whether a plugin is enabled.
 * Priority: blocklist (hard block) > merged enabledPlugins > default (not enabled).
 */
function isPluginEnabled(
  pluginKey: string,
  blocked: Set<string>,
  mergedEnabled: EnabledPluginsMap,
): boolean {
  if (blocked.has(pluginKey)) return false;
  return isEnabledValue(mergedEnabled[pluginKey]);
}

// ==========================================
// Plugin Discovery
// ==========================================

function readManifest(pluginDir: string): PluginManifest | null {
  const manifestPath = path.join(pluginDir, '.claude-plugin', 'plugin.json');
  if (!fs.existsSync(manifestPath)) return null;

  try {
    const raw = fs.readFileSync(manifestPath, 'utf-8');
    return JSON.parse(raw) as PluginManifest;
  } catch {
    return null;
  }
}

/**
 * Scan marketplace and external plugin directories for installed plugins.
 */
export function discoverMarketplacePlugins(): DiscoveredPlugin[] {
  if (isCacheValid()) return cachedPlugins!;

  const plugins: DiscoveredPlugin[] = [];
  const claudeDir = path.join(os.homedir(), '.claude', 'plugins');

  // Scan marketplaces: ~/.claude/plugins/marketplaces/{mkt}/plugins/*/
  const marketplacesDir = path.join(claudeDir, 'marketplaces');
  if (fs.existsSync(marketplacesDir)) {
    try {
      const marketplaces = fs.readdirSync(marketplacesDir);
      for (const mkt of marketplaces) {
        const pluginsDir = path.join(marketplacesDir, mkt, 'plugins');
        if (!fs.existsSync(pluginsDir)) continue;

        try {
          const pluginNames = fs.readdirSync(pluginsDir);
          for (const pluginName of pluginNames) {
            const pluginDir = path.join(pluginsDir, pluginName);
            if (!fs.statSync(pluginDir).isDirectory()) continue;

            const manifest = readManifest(pluginDir);
            const name = manifest?.name || pluginName;
            const description = manifest?.description || `Plugin: ${name}`;

            plugins.push({
              name,
              description,
              author: manifest?.author,
              path: path.resolve(pluginDir),
              marketplace: mkt,
              location: 'plugins',
              hasCommands: fs.existsSync(path.join(pluginDir, 'commands')),
              hasSkills: fs.existsSync(path.join(pluginDir, 'skills')),
              hasAgents: fs.existsSync(path.join(pluginDir, 'agents')),
            });
          }
        } catch {
          // ignore per-marketplace errors
        }
      }
    } catch {
      // ignore
    }
  }

  // Scan external_plugins: ~/.claude/plugins/external_plugins/*/
  const externalDir = path.join(claudeDir, 'external_plugins');
  if (fs.existsSync(externalDir)) {
    try {
      const externalNames = fs.readdirSync(externalDir);
      for (const pluginName of externalNames) {
        const pluginDir = path.join(externalDir, pluginName);
        if (!fs.statSync(pluginDir).isDirectory()) continue;

        const manifest = readManifest(pluginDir);
        const name = manifest?.name || pluginName;
        const description = manifest?.description || `Plugin: ${name}`;

        plugins.push({
          name,
          description,
          author: manifest?.author,
          path: path.resolve(pluginDir),
          marketplace: 'external',
          location: 'external_plugins',
          hasCommands: fs.existsSync(path.join(pluginDir, 'commands')),
          hasSkills: fs.existsSync(path.join(pluginDir, 'skills')),
          hasAgents: fs.existsSync(path.join(pluginDir, 'agents')),
        });
      }
    } catch {
      // ignore
    }
  }

  cachedPlugins = plugins;
  cacheTimestamp = Date.now();
  console.log(`[plugin-discovery] Found ${plugins.length} plugins`);
  return plugins;
}

// ==========================================
// Public API
// ==========================================

/**
 * Get full plugin info list for API responses.
 * Reads enabledPlugins from all settings layers to match SDK resolution.
 *
 * @param cwd - Working directory for project/local settings resolution.
 *              Defaults to process.cwd().
 */
export function getPluginInfoList(cwd?: string): PluginInfo[] {
  const plugins = discoverMarketplacePlugins();
  const blocked = readBlocklist();
  const mergedEnabled = readMergedEnabledPlugins(cwd);

  return plugins.map((plugin) => {
    const pluginKey = `${plugin.name}@${plugin.marketplace}`;
    const isBlocked = blocked.has(pluginKey);
    const enabled = isPluginEnabled(pluginKey, blocked, mergedEnabled);

    return {
      name: plugin.name,
      description: plugin.description,
      author: plugin.author,
      path: plugin.path,
      marketplace: plugin.marketplace,
      location: plugin.location,
      hasCommands: plugin.hasCommands,
      hasSkills: plugin.hasSkills,
      hasAgents: plugin.hasAgents,
      blocked: isBlocked,
      enabled,
    };
  });
}

/**
 * Determine the value to write for an enable/disable operation.
 * Preserves string[] (version constraints) when enabling — only writes `true`
 * if there's no existing constraint across any layer. Always writes `false` for disable.
 *
 * @param allLayers - all settings layers to search for existing constraints,
 *                    ordered from lowest to highest priority.
 */
function resolveWriteValue(
  pluginKey: string,
  enabled: boolean,
  allLayers: EnabledPluginsMap[],
): boolean | string[] {
  if (!enabled) return false;
  // Search all layers (highest priority first) for an existing string[] constraint
  for (let i = allLayers.length - 1; i >= 0; i--) {
    const existing = allLayers[i][pluginKey];
    if (Array.isArray(existing)) return existing;
  }
  return true;
}

export interface SetPluginResult {
  success: boolean;
  /** Which settings layer was written to */
  layer: 'user' | 'local';
  /** If the write was escalated to local because a higher layer overrides user */
  escalated: boolean;
}

/**
 * Set enabled state for a plugin.
 *
 * Default write target: user-level ~/.claude/settings.json.
 * If a higher-priority layer (project or local) would override the user-level
 * write, the write is escalated to the local layer (.claude/settings.local.json)
 * which has the highest priority and is gitignored.
 *
 * @param pluginKey - "name@marketplace"
 * @param enabled - desired state
 * @param cwd - working directory for project/local layer resolution.
 *              Required for correct escalation detection.
 */
export function setPluginEnabled(
  pluginKey: string,
  enabled: boolean,
  cwd?: string,
): SetPluginResult {
  const effectiveCwd = cwd || process.cwd();

  // Read each layer independently to detect overrides
  const userEnabled = extractEnabledPlugins(readJsonFile(getUserSettingsPath()));
  const projectEnabled = extractEnabledPlugins(readJsonFile(getProjectSettingsPath(effectiveCwd)));
  const localEnabled = extractEnabledPlugins(readJsonFile(getLocalSettingsPath(effectiveCwd)));

  const allLayers = [userEnabled, projectEnabled, localEnabled];

  // Check if writing to user-level would achieve the desired effective state.
  // Simulate: set the value at user level, then re-merge.
  const simulatedUser = { ...userEnabled };
  simulatedUser[pluginKey] = resolveWriteValue(pluginKey, enabled, allLayers);
  const simulatedMerged = { ...simulatedUser, ...projectEnabled, ...localEnabled };
  const simulatedEffective = isEnabledValue(simulatedMerged[pluginKey]);

  if (simulatedEffective === enabled) {
    // User-level write is sufficient — no higher layer overrides it
    writeEnabledPluginEntry(getUserSettingsPath(), pluginKey, simulatedUser[pluginKey]);
    invalidateCache();
    return { success: true, layer: 'user', escalated: false };
  }

  // A higher-priority layer overrides the user-level write.
  // Escalate to local layer (highest priority, gitignored).
  // Pass allLayers so constraints from any layer (including project) are preserved.
  const writeValue = resolveWriteValue(pluginKey, enabled, allLayers);
  writeEnabledPluginEntry(getLocalSettingsPath(effectiveCwd), pluginKey, writeValue);
  invalidateCache();
  return { success: true, layer: 'local', escalated: true };
}

/**
 * Force-refresh cache (e.g. after install/uninstall).
 */
export function invalidatePluginCache(): void {
  invalidateCache();
}
