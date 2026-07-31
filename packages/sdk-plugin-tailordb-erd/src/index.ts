import type { Plugin } from "@tailor-platform/sdk";

/** Unique identifier for the TailorDB ERD plugin. */
export const TailorDBErdPluginID = "@tailor-platform/sdk-plugin-tailordb-erd";

/** Configuration for {@link tailordbErdPlugin}. */
export interface TailorDBErdPluginOptions {
  /** TailorDB namespace name → static website name the ERD viewer deploys to. */
  sites: Record<string, string>;
}

/**
 * Registers TailorDB ERD viewer configuration via `definePlugins()`.
 * The `tailor tailordb erd` commands read `sites` from this plugin instance to
 * resolve the target static website for each TailorDB namespace.
 * @param options - Plugin options.
 * @returns Plugin instance carrying the ERD configuration.
 */
export function tailordbErdPlugin(
  options: TailorDBErdPluginOptions,
): Plugin<unknown, TailorDBErdPluginOptions> {
  return {
    id: TailorDBErdPluginID,
    description: "Configures the TailorDB ERD viewer (`tailor tailordb erd` commands)",
    pluginConfig: options,
  };
}
