import type { LoadedConfig } from "./config-loader";

/**
 * Extracts every namespace key declared under `config.db`, including those
 * declared with `{ external: true }`.
 * @param config - Loaded application configuration.
 * @returns Namespace names in insertion order.
 */
export function extractAllNamespaces(config: LoadedConfig): string[] {
  const namespaces = new Set<string>();

  if (config.db) {
    for (const namespaceName of Object.keys(config.db)) {
      namespaces.add(namespaceName);
    }
  }

  return Array.from(namespaces);
}

/**
 * Extracts namespace keys under `config.db` that this app owns
 * (i.e. not declared with `{ external: true }`). Use this for destructive
 * operations like `tailordb truncate --all` to avoid touching namespaces
 * owned by other apps.
 * @param config - Loaded application configuration.
 * @returns Owned namespace names in insertion order.
 */
export function extractOwnedNamespaces(config: LoadedConfig): string[] {
  const namespaces = new Set<string>();

  if (config.db) {
    for (const [namespaceName, nsConfig] of Object.entries(config.db)) {
      if ("external" in nsConfig && nsConfig.external === true) continue;
      namespaces.add(namespaceName);
    }
  }

  return Array.from(namespaces);
}
