import * as path from "pathe";
import {
  generateIdpSeedScriptCode,
  generateIdpTruncateScriptCode,
  processIdpUser,
} from "#/plugin/builtin/seed/idp-user-processor";
import { SeedGeneratorID, type SeedPluginOptions } from "#/plugin/builtin/seed/index";
import {
  buildSeedNamespaceConfigs,
  type SeedNamespaceConfig,
} from "#/plugin/builtin/seed/seed-type-processor";
import { getAuthInput } from "./auth-input";
import { loadApplicationNamespaces } from "./tailordb-namespaces";
import type { LoadedConfig } from "./config-loader";

export type { SeedNamespaceConfig };

/**
 * IdP `_User` seeding context, present when the config uses the built-in IdP
 * with a user profile type.
 */
export interface SeedIdpUserContext {
  /** IdP namespace the `_User` records belong to. */
  idpNamespace: string;
  /** Server-side script that creates `_User` records from seed rows. */
  seedScriptCode: string;
  /** Server-side script that deletes all `_User` records. */
  truncateScriptCode: string;
}

/**
 * Everything a seed run needs from the local config: the seed data location,
 * per-namespace seeding order, and IdP user context.
 */
export interface SeedContext {
  /** The loaded Tailor config. */
  config: LoadedConfig;
  /** Absolute path to the seedPlugin output directory. */
  distPath: string;
  /** Default machine user name from seedPlugin options, if configured. */
  machineUserName?: string | undefined;
  /** Seed ordering information per TailorDB namespace. */
  namespaces: SeedNamespaceConfig[];
  /** IdP `_User` seeding context, or null when not applicable. */
  idpUser: SeedIdpUserContext | null;
}

/**
 * Options for {@link loadSeedContext}.
 */
export interface LoadSeedContextOptions {
  /** Path to tailor.config.ts. Defaults to searching from the current directory. */
  configPath?: string;
}

/**
 * Load the seed context from the local config. Requires `seedPlugin` to be
 * configured in the config's plugins. A relative `distPath` in the seedPlugin
 * options is resolved against the config file's directory.
 * @param options - Seed context loading options.
 * @returns The seed context computed from the local config.
 */
export async function loadSeedContext(options: LoadSeedContextOptions = {}): Promise<SeedContext> {
  const { config, plugins, application, namespaces } = await loadApplicationNamespaces({
    configPath: options.configPath,
  });

  const seedPlugin = plugins.find((plugin) => plugin.id === SeedGeneratorID);
  if (!seedPlugin) {
    throw new Error(
      `seedPlugin is not configured in ${config.path}. ` +
        'Add seedPlugin({ distPath: "./seed" }) from "@tailor-platform/sdk/plugin/seed" to definePlugins().',
    );
  }
  const pluginOptions = seedPlugin.pluginConfig as SeedPluginOptions;

  const authInput = getAuthInput(application);
  const idpUserMeta = authInput ? processIdpUser(authInput) : undefined;
  const idpUser: SeedIdpUserContext | null = idpUserMeta
    ? {
        idpNamespace: idpUserMeta.idpNamespace,
        seedScriptCode: generateIdpSeedScriptCode(idpUserMeta.idpNamespace),
        truncateScriptCode: generateIdpTruncateScriptCode(idpUserMeta.idpNamespace),
      }
    : null;

  return {
    config,
    distPath: path.resolve(path.dirname(config.path), pluginOptions.distPath),
    machineUserName: pluginOptions.machineUserName,
    namespaces: buildSeedNamespaceConfigs(namespaces),
    idpUser,
  };
}
