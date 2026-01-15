import { loadConfig } from "@/cli/config-loader";
import type { AppConfig } from "@/configure/config";
import type { TailorDBServiceConfig } from "@/configure/services/tailordb/types";

/**
 * Resolve a single TailorDB namespace from a config object.
 * @param {AppConfig} config - Loaded Tailor SDK config.
 * @returns {string} The resolved namespace.
 */
export function resolveSingleNamespace(config: AppConfig): string;
/**
 * Resolve a single TailorDB namespace from config file.
 * @param {string | undefined} configPath - Path to config file.
 * @returns {Promise<string>} The resolved namespace.
 */
export function resolveSingleNamespace(configPath?: string): Promise<string>;
export function resolveSingleNamespace(
  configOrPath?: AppConfig | string,
): string | Promise<string> {
  // Async version: load config from path
  if (typeof configOrPath === "string" || configOrPath === undefined) {
    return (async () => {
      const { config } = await loadConfig(configOrPath);
      return resolveSingleNamespaceFromConfig(config);
    })();
  }
  // Sync version: use provided config
  return resolveSingleNamespaceFromConfig(configOrPath);
}

function resolveSingleNamespaceFromConfig(config: AppConfig): string {
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

interface ResolveDbConfigResult {
  namespace: string;
  dbConfig: TailorDBServiceConfig;
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
): ResolveDbConfigResult;
/**
 * Resolve TailorDB config and namespace from config file.
 * @param {string | undefined} configPath - Path to config file.
 * @param {string | undefined} explicitNamespace - Namespace override.
 * @returns {Promise<{ namespace: string; dbConfig: TailorDBServiceConfig }>} Resolved namespace and config.
 */
export function resolveDbConfig(
  configPath: string | undefined,
  explicitNamespace: string | undefined,
): Promise<ResolveDbConfigResult>;
export function resolveDbConfig(
  configOrPath: AppConfig | string | undefined,
  explicitNamespace?: string,
): ResolveDbConfigResult | Promise<ResolveDbConfigResult> {
  // Async version: load config from path
  if (typeof configOrPath === "string" || configOrPath === undefined) {
    return (async () => {
      const { config } = await loadConfig(configOrPath);
      return resolveDbConfigFromConfig(config, explicitNamespace);
    })();
  }
  // Sync version: use provided config
  return resolveDbConfigFromConfig(configOrPath, explicitNamespace);
}

function resolveDbConfigFromConfig(
  config: AppConfig,
  explicitNamespace?: string,
): ResolveDbConfigResult {
  const namespace = explicitNamespace ?? resolveSingleNamespaceFromConfig(config);
  const dbConfig = config.db?.[namespace];

  if (!dbConfig || typeof dbConfig !== "object" || "external" in dbConfig) {
    throw new Error(`TailorDB namespace "${namespace}" not found in config.db.`);
  }

  return { namespace, dbConfig };
}
