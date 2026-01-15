import type { AppConfig } from "@/configure/config";

/**
 * Resolve TailorDB config and namespace.
 * @param {AppConfig} config - Loaded Tailor SDK config.
 * @param {string | undefined} explicitNamespace - Namespace override.
 * @returns {{ namespace: string; erdSite: string | undefined }} Resolved namespace and erdSite.
 */
export function resolveDbConfig(
  config: AppConfig,
  explicitNamespace?: string,
): { namespace: string; erdSite: string | undefined } {
  const namespace = explicitNamespace ?? Object.keys(config.db ?? {})[0];

  if (!namespace) {
    throw new Error(
      "No TailorDB namespaces found in config. Please define db services in tailor.config.ts or pass --namespace.",
    );
  }

  const dbConfig = config.db?.[namespace];

  if (!dbConfig || typeof dbConfig !== "object" || "external" in dbConfig) {
    throw new Error(`TailorDB namespace "${namespace}" not found in config.db.`);
  }

  return { namespace, erdSite: dbConfig.erdSite };
}

/**
 * Get all namespaces with erdSite configured.
 * @param {AppConfig} config - Loaded Tailor SDK config.
 * @returns {Array<{ namespace: string; erdSite: string }>} Namespaces with erdSite.
 */
export function resolveAllErdSites(
  config: AppConfig,
): Array<{ namespace: string; erdSite: string }> {
  const results: Array<{ namespace: string; erdSite: string }> = [];

  for (const [namespace, dbConfig] of Object.entries(config.db ?? {})) {
    if (dbConfig && typeof dbConfig === "object" && !("external" in dbConfig) && dbConfig.erdSite) {
      results.push({ namespace, erdSite: dbConfig.erdSite });
    }
  }

  return results;
}
