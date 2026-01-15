import type { AppConfig } from "@/configure/config";
import type { TailorDBServiceConfig } from "@/configure/services/tailordb/types";

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

  return { namespace, dbConfig };
}
