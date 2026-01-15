import { loadConfig } from "../../config-loader";

/**
 * Read all TailorDB namespaces from config.
 * @param {string | undefined} configPath - Optional path to the SDK config file.
 * @returns {Promise<string[]>} List of TailorDB namespaces.
 */
async function getAllNamespaces(configPath?: string): Promise<string[]> {
  const { config } = await loadConfig(configPath);
  const namespaces = new Set<string>();

  if (config.db) {
    for (const [namespaceName] of Object.entries(config.db)) {
      namespaces.add(namespaceName);
    }
  }

  return Array.from(namespaces);
}

/**
 * Resolve a single TailorDB namespace from config.
 * @param {string | undefined} configPath - Optional path to the SDK config file.
 * @returns {Promise<string>} The resolved namespace.
 */
export async function resolveSingleNamespace(configPath?: string): Promise<string> {
  const namespaces = await getAllNamespaces(configPath);

  if (namespaces.length === 0) {
    throw new Error(
      "No TailorDB namespaces found in config. Please define db services in tailor.config.ts or pass --namespace.",
    );
  }

  if (namespaces.length > 1) {
    throw new Error(
      `Multiple TailorDB namespaces found in config: ${namespaces.join(
        ", ",
      )}. Please specify one using --namespace.`,
    );
  }

  return namespaces[0]!;
}
