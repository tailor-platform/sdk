// No zod here: getGeneratedTable validates plugins with these checks from a bundled executor.

export const DEFINITION_TIME_HOOK_KEYS = [
  "onTableLoaded",
  "onTailorDBNamespaceLoaded",
  "onNamespaceLoaded",
] as const;

/** Hook fields of a plugin-shaped value whose functions have not been validated yet. */
type DefinitionTimeHookFields = Partial<
  Record<(typeof DEFINITION_TIME_HOOK_KEYS)[number], unknown>
>;

/**
 * Checks if a plugin has definition-time hooks, which require `importPath`.
 * @param plugin - The plugin-shaped value to inspect.
 * @returns True if the plugin defines any of {@link DEFINITION_TIME_HOOK_KEYS}.
 */
export function hasDefinitionTimeHooks(plugin: DefinitionTimeHookFields): boolean {
  return DEFINITION_TIME_HOOK_KEYS.some((key) => !!plugin[key]);
}

export const BOTH_TAILORDB_NAMESPACE_HOOKS_MESSAGE =
  "'onNamespaceLoaded' is the deprecated name of 'onTailorDBNamespaceLoaded'. Define only 'onTailorDBNamespaceLoaded'.";

/**
 * Checks if a plugin defines the TailorDB namespace hook under both its name and its deprecated former name.
 * @param plugin - The plugin-shaped value to inspect.
 * @returns True if both onTailorDBNamespaceLoaded and onNamespaceLoaded are set.
 */
export function definesBothTailorDBNamespaceHooks(plugin: DefinitionTimeHookFields): boolean {
  return plugin.onTailorDBNamespaceLoaded !== undefined && plugin.onNamespaceLoaded !== undefined;
}
