import type { Plugin } from "./types";

/**
 * Build a lookup for a specific builtin plugin's `pluginConfig`, keyed by the
 * plugin's `id`. The generic parameter lets each plugin module bind its own
 * config type without exporting that type or duplicating its shape at every
 * call site — the runtime `id` check has no compiler-level link to
 * `PluginConfig`, so the cast lives here once instead of once per caller.
 * @param id - The target plugin's unique id
 * @returns A function that finds the plugin by id in a `Plugin[]` array and returns its `pluginConfig`
 */
export function createPluginConfigResolver<PluginConfig>(id: string) {
  return function resolvePluginConfig(plugins: readonly Plugin[]): PluginConfig | undefined {
    const plugin = plugins.find((candidate) => candidate.id === id);
    return plugin?.pluginConfig as PluginConfig | undefined;
  };
}
