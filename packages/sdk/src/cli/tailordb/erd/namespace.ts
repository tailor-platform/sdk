import type { AppConfig } from "@/configure/config";
import type { TailorDBServiceConfig } from "@/configure/services/tailordb/types";

/**
 * Resolve a single TailorDB namespace from a config object.
 * @param {AppConfig} config - Loaded Tailor SDK config.
 * @returns {string} The resolved namespace.
 */
export function resolveSingleNamespace(config: AppConfig): string {
  const namespaces = new Set<string>();

  if (config.db) {
    for (const [namespaceName] of Object.entries(config.db)) {
      namespaces.add(namespaceName);
    }
  }

  const namespaceList = Array.from(namespaces);

  if (namespaceList.length === 0) {
    throw new Error(
      "No TailorDB namespaces found in config. Please define db services in tailor.config.ts or pass --namespace.",
    );
  }

  if (namespaceList.length > 1) {
    throw new Error(
      `Multiple TailorDB namespaces found in config: ${namespaceList.join(
        ", ",
      )}. Please specify one using --namespace.`,
    );
  }

  return namespaceList[0]!;
}

/**
 * Resolve TailorDB config and namespace.
 * @param {AppConfig} config - Loaded Tailor SDK config.
 * @param {string | undefined} explicitNamespace - Namespace override.
 * @returns {{ namespace: string; dbConfig: TailorDBServiceConfig }} Resolved namespace and config.
 */
export function resolveDbConfig(
  config: AppConfig,
  explicitNamespace?: string,
): { namespace: string; dbConfig: TailorDBServiceConfig } {
  const namespace = explicitNamespace ?? resolveSingleNamespace(config);
  const dbConfig = config.db?.[namespace];

  if (!dbConfig || typeof dbConfig !== "object" || "external" in dbConfig) {
    throw new Error(`TailorDB namespace "${namespace}" not found in config.db.`);
  }

  return { namespace, dbConfig };
}
