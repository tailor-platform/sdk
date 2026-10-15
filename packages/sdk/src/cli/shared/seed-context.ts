import * as path from "pathe";
import { assertUniqueLocalTailorDBTypeNames } from "#/cli/services/tailordb/type-name-validation";
import {
  generateIdpListUsersScriptCode,
  generateIdpSeedScriptCode,
  generateIdpTruncateScriptCode,
  processIdpUser,
} from "#/plugin/builtin/seed/idp-user-processor";
import { SeedGeneratorID } from "#/plugin/builtin/seed/index";
import {
  buildSeedNamespaceConfigs,
  type SeedNamespaceConfig,
} from "#/plugin/builtin/seed/seed-type-processor";
import { resolvePluginConfig } from "#/plugin/get-plugin-config";
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
  /** Server-side script that lists every `_User` record to delete. */
  listScriptCode: string;
  /** Server-side script that deletes one chunk of listed `_User` records. */
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
  /**
   * Named combinations of dataset directory names from seedPlugin options.
   * Always set by {@link loadSeedContext}; optional so a context built elsewhere stays valid.
   */
  datasets?: Record<string, readonly string[]>;
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
 * options is resolved against the current working directory — the same base
 * `tailor generate` writes it to.
 * @param options - Seed context loading options.
 * @returns The seed context computed from the local config.
 */
export async function loadSeedContext(options: LoadSeedContextOptions = {}): Promise<SeedContext> {
  const { config, plugins, application, namespaces } = await loadApplicationNamespaces({
    configPath: options.configPath,
  });

  // Seed files and type filters identify types by bare name, so enforce the
  // same cross-namespace uniqueness that generation and deploy enforce.
  assertUniqueLocalTailorDBTypeNames({ tailorDBServices: application.tailorDBServices });

  const pluginOptions = resolvePluginConfig(plugins, SeedGeneratorID);
  if (!pluginOptions) {
    throw new Error(
      `seedPlugin is not configured in ${config.path}. ` +
        'Add seedPlugin({ distPath: "./seed" }) from "@tailor-platform/sdk/plugin/seed" to definePlugins().',
    );
  }
  if (typeof pluginOptions.distPath !== "string" || pluginOptions.distPath === "") {
    throw new Error(
      `seedPlugin in ${config.path} has no distPath option. ` +
        'Pass seedPlugin({ distPath: "./seed" }) so seed data has a location.',
    );
  }

  // userProfile is only populated once auth namespaces are resolved (the
  // generate flow does the same after loading TailorDB namespaces).
  await application.authService?.resolveNamespaces();
  const authInput = getAuthInput(application);
  const idpUserMeta = authInput ? processIdpUser(authInput) : undefined;
  const idpUser: SeedIdpUserContext | null = idpUserMeta
    ? {
        idpNamespace: idpUserMeta.idpNamespace,
        seedScriptCode: generateIdpSeedScriptCode(idpUserMeta.idpNamespace),
        listScriptCode: generateIdpListUsersScriptCode(idpUserMeta.idpNamespace),
        truncateScriptCode: generateIdpTruncateScriptCode(idpUserMeta.idpNamespace),
      }
    : null;

  return {
    config,
    distPath: path.resolve(pluginOptions.distPath),
    machineUserName: pluginOptions.machineUserName,
    datasets: parseDatasets(pluginOptions.datasets, config.path),
    namespaces: buildSeedNamespaceConfigs(namespaces),
    idpUser,
  };
}

const DATASET_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

function assertDatasetName(name: string, configPath: string): void {
  if (!DATASET_NAME_PATTERN.test(name)) {
    throw new Error(
      `Dataset name "${name}" in the seedPlugin datasets option of ${configPath} is invalid. ` +
        "Use letters, digits, `-` and `_`, starting with a letter or digit.",
    );
  }
}

function parseDatasets(value: unknown, configPath: string): Record<string, readonly string[]> {
  if (value === undefined) return {};
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(
      `seedPlugin datasets must map names to lists of dataset directory names in ${configPath}.`,
    );
  }
  const datasets: Record<string, readonly string[]> = {};
  for (const [name, directories] of Object.entries(value)) {
    assertDatasetName(name, configPath);
    if (!Array.isArray(directories)) {
      throw new Error(
        `seedPlugin datasets.${name} must be an array of dataset directory names in ${configPath}.`,
      );
    }
    if (directories.length === 0) {
      throw new Error(`seedPlugin datasets.${name} lists no dataset directories in ${configPath}.`);
    }
    for (const directory of directories) {
      if (typeof directory !== "string") {
        throw new Error(
          `seedPlugin datasets.${name} must be an array of dataset directory names in ${configPath}.`,
        );
      }
      assertDatasetName(directory, configPath);
    }
    datasets[name] = directories as string[];
  }
  return datasets;
}
