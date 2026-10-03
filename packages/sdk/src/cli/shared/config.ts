import { normalizeDb } from "#/parser/app-config/normalize-db";
import type { NormalizedDb } from "#/types/app-config.generated";
import type { LoadedConfig } from "./config-loader";

/**
 * Read normalized namespaces, including configurations constructed by CLI consumers.
 * @param config - Application configuration
 * @returns Normalized namespace entries
 */
export function normalizedDbOf(config: Pick<LoadedConfig, "db" | "normalizedDb">): NormalizedDb {
  return config.normalizedDb ?? normalizeDb(config.db);
}

/**
 * Extract every configured namespace.
 * @param config - Loaded application configuration
 * @returns Namespace names in config order
 */
export function extractAllNamespaces(config: LoadedConfig): string[] {
  return Object.keys(normalizedDbOf(config));
}

/**
 * Extract namespaces deployed by this application.
 * @param config - Loaded application configuration
 * @returns Owned namespace names in config order
 */
export function extractOwnedNamespaces(config: LoadedConfig): string[] {
  return Object.entries(normalizedDbOf(config))
    .filter(([, entry]) => entry.owned)
    .map(([name]) => name);
}
