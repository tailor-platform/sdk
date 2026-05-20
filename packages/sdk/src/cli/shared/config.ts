import type { LoadedConfig } from "./config-loader";

/**
 * Extracts all owned (non-external) namespace names from loaded application config.
 * Namespaces declared with `{ external: true }` are referenced from other apps and
 * are excluded so that destructive operations (e.g. truncate) do not touch them.
 * @param config - Loaded application configuration.
 * @returns Owned namespace names in insertion order.
 */
export function extractAllNamespaces(config: LoadedConfig): string[] {
  const namespaces = new Set<string>();

  if (config.db) {
    for (const [namespaceName, nsConfig] of Object.entries(config.db)) {
      if ((nsConfig as { external?: boolean })?.external) continue;
      namespaces.add(namespaceName);
    }
  }

  return Array.from(namespaces);
}
