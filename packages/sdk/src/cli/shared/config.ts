import type { LoadedConfig } from "./config-loader";

/**
 * Extracts all configured namespace names from loaded application config.
 * Currently namespaces are derived from the `db` section.
 * @param config - Loaded application configuration.
 * @returns Namespace names in insertion order.
 */
export function extractAllNamespaces(config: LoadedConfig): string[] {
  const namespaces = new Set<string>();

  // Collect namespace names from db configuration
  if (config.db) {
    for (const [namespaceName] of Object.entries(config.db)) {
      namespaces.add(namespaceName);
    }
  }

  return Array.from(namespaces);
}
