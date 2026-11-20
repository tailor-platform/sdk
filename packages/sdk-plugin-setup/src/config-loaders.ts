import {
  extractOwnedNamespaces,
  getNamespacesWithMigrations,
  loadConfig,
} from "@tailor-platform/sdk/cli";
import * as path from "pathe";
import { defaultLoadSeedSettings } from "./seed-settings";

/**
 * Read the name an app's config sets.
 * @param configPath - Absolute path to the app's tailor.config.ts
 * @returns The config's name, if it sets one
 */
export async function defaultLoadConfigName(configPath: string): Promise<string | undefined> {
  const { config } = await loadConfig(configPath);
  return config.name;
}

/**
 * Read the id an app's config sets.
 * @param configPath - Absolute path to the app's tailor.config.ts
 * @returns The config's id, if it sets one
 */
export async function defaultLoadConfigId(configPath: string): Promise<string | undefined> {
  const { config } = await loadConfig(configPath);
  return config.id;
}

/**
 * List the TailorDB namespaces an app's config owns.
 * @param configPath - Absolute path to the app's tailor.config.ts
 * @returns The owned namespaces
 */
export async function defaultLoadErdNamespaces(configPath: string): Promise<string[]> {
  const { config } = await loadConfig(configPath);
  return extractOwnedNamespaces(config);
}

/**
 * Tell whether an app's config has a TailorDB namespace with a migrations directory.
 * @param configPath - Absolute path to the app's tailor.config.ts
 * @returns Whether any namespace has migrations
 */
export async function defaultLoadHasMigrations(configPath: string): Promise<boolean> {
  const { config } = await loadConfig(configPath);
  return getNamespacesWithMigrations(config, path.dirname(configPath)).length > 0;
}

/**
 * Tell whether an app's config uses seedPlugin.
 * @param configPath - Absolute path to the app's tailor.config.ts
 * @returns Whether the config uses seedPlugin
 */
export async function defaultLoadHasSeeds(configPath: string): Promise<boolean> {
  return (await defaultLoadSeedSettings(configPath)) !== null;
}
