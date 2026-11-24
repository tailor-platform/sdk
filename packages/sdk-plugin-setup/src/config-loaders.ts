import {
  extractOwnedNamespaces,
  getNamespacesWithMigrations,
  loadConfigFile,
} from "@tailor-platform/sdk/cli";
import * as path from "pathe";
import { defaultLoadSeedSettings } from "./seed-settings";

/** Whether a config is a `defineConfig()` config or a `defineWorkspace()` / `defineApp()` one. */
export type ConfigKind = "config" | "workspace";

/**
 * Tell which kind of config a file defines.
 * @param configPath - Absolute path to the app's tailor.config.ts
 * @returns The config's kind
 */
export async function defaultLoadConfigKind(configPath: string): Promise<ConfigKind> {
  return (await loadConfigFile(configPath)).kind;
}

/**
 * Read the name an app's config sets: a `defineApp()` config's application name, and nothing for
 * a `defineWorkspace()` config.
 * @param configPath - Absolute path to the app's tailor.config.ts
 * @returns The config's name, if it sets one
 */
export async function defaultLoadConfigName(configPath: string): Promise<string | undefined> {
  const loaded = await loadConfigFile(configPath);
  if (loaded.kind === "config") return loaded.config.name;
  const { workspace } = loaded;
  return workspace.definedBy === "defineApp" ? Object.keys(workspace.apps)[0] : undefined;
}

/**
 * Read the id an app's config sets. A workspace config has none.
 * @param configPath - Absolute path to the app's tailor.config.ts
 * @returns The config's id, if it sets one
 */
export async function defaultLoadConfigId(configPath: string): Promise<string | undefined> {
  const loaded = await loadConfigFile(configPath);
  return loaded.kind === "config" ? loaded.config.id : undefined;
}

/**
 * List the TailorDB namespaces an app's config owns.
 * @param configPath - Absolute path to the app's tailor.config.ts
 * @returns The owned namespaces
 */
export async function defaultLoadErdNamespaces(configPath: string): Promise<string[]> {
  const loaded = await loadConfigFile(configPath);
  return loaded.kind === "config"
    ? extractOwnedNamespaces(loaded.config)
    : Object.keys(loaded.workspace.db);
}

/**
 * Tell whether an app's config has a TailorDB namespace with a migrations directory.
 * @param configPath - Absolute path to the app's tailor.config.ts
 * @returns Whether any namespace has migrations
 */
export async function defaultLoadHasMigrations(configPath: string): Promise<boolean> {
  const loaded = await loadConfigFile(configPath);
  const config = loaded.kind === "config" ? loaded.config : loaded.workspace;
  return getNamespacesWithMigrations(config, path.dirname(configPath)).length > 0;
}

/**
 * List, for each application a config deploys, the TailorDB namespaces with migrations that the
 * application does not list.
 * @param configPath - Absolute path to the app's tailor.config.ts
 * @returns The unlisted namespaces by application name
 */
export async function loadUnlistedMigrationNamespaces(
  configPath: string,
): Promise<Record<string, string[]>> {
  const loaded = await loadConfigFile(configPath);
  if (loaded.kind === "config") return { [loaded.config.name]: [] };
  const { workspace } = loaded;
  const withMigrations = getNamespacesWithMigrations(workspace, path.dirname(configPath)).map(
    (entry) => entry.namespace,
  );
  return Object.fromEntries(
    Object.entries(workspace.apps).map(([name, app]) => [
      name,
      withMigrations.filter((namespace) => !app.db.includes(namespace)),
    ]),
  );
}

/**
 * Tell whether an app's config uses seedPlugin.
 * @param configPath - Absolute path to the app's tailor.config.ts
 * @returns Whether the config uses seedPlugin
 */
export async function defaultLoadHasSeeds(configPath: string): Promise<boolean> {
  return (await defaultLoadSeedSettings(configPath)) !== null;
}
