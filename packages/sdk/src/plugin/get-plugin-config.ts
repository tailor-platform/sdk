import type { Plugin } from "./types";

/**
 * Read a plugin's `pluginConfig`, typed to the config shape the plugin
 * itself owns. A runtime `id` match has no compiler-level link to a generic
 * type parameter, so the cast lives here once instead of once per caller.
 * @param plugin - The plugin instance to read config from
 * @returns The plugin's `pluginConfig`, typed as `PluginConfig`
 */
export function getPluginConfig<PluginConfig>(plugin: Plugin): PluginConfig | undefined {
  return plugin.pluginConfig as PluginConfig | undefined;
}
