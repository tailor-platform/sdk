import type { Plugin, PluginConfigRegistry } from "./types";

/**
 * Find a plugin by `id` in a `Plugin[]` array and return its config, typed
 * via {@link PluginConfigRegistry} -- no explicit type argument, no import
 * of the plugin's own option type required. A runtime `id` match has no
 * compiler-level link to a generic type parameter on its own, so this keys
 * off the registry instead: an `id` not registered there fails to compile
 * at the call site.
 * @param plugins - The configured plugins to search
 * @param id - A registered plugin id (registered via declaration merging on {@link PluginConfigRegistry})
 * @returns The matching plugin's config, or `undefined` if not configured
 */
export function resolvePluginConfig<Id extends keyof PluginConfigRegistry>(
  plugins: readonly Plugin[],
  id: Id,
): PluginConfigRegistry[Id] | undefined {
  const plugin = plugins.find((candidate) => candidate.id === id);
  return plugin?.pluginConfig as PluginConfigRegistry[Id] | undefined;
}
