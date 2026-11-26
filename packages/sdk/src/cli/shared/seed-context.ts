import * as fs from "node:fs";
import * as path from "pathe";
import { assertUniqueLocalTailorDBTypeNames } from "#/cli/services/tailordb/type-name-validation";
import {
  generateIdpListUsersScriptCode,
  generateIdpSeedScriptCode,
  generateIdpTruncateScriptCode,
} from "#/plugin/builtin/seed/idp-user-processor";
import { SeedGeneratorID, soleIdpUser, type SeedPluginOptions } from "#/plugin/builtin/seed/index";
import {
  buildSeedNamespaceConfigs,
  type SeedNamespaceConfig,
} from "#/plugin/builtin/seed/seed-type-processor";
import { resolvePluginConfig } from "#/plugin/get-plugin-config";
import { namesSharedAcrossNamespaces } from "#/utils/tailordb-type-names";
import { getAuthInput } from "./auth-input";
import { configOf, machineUserAuths } from "./config-file";
import { atConfigSource, tailorDBTypeNameGroupsOf } from "./config-loader";
import { CLIError, locatedCLIError } from "./errors";
import { resolveMachineUser } from "./machine-user";
import { loadConfigFileNamespaces } from "./tailordb-namespaces";
import { configIssuesError } from "./validation-errors";
import type { AuthInvokerObject } from "#/types/auth.generated";
import type { LoadedConfig } from "./config-loader";
import type { FlatIssue } from "./zod-issues";

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
  /** Default machine user from seedPlugin options, if configured, as `<name>` or `<auth>/<name>`. */
  machineUserName?: string | undefined;
  /**
   * Named combinations of dataset directory names from seedPlugin options.
   * Always set by {@link loadSeedContext}; optional so a context built elsewhere stays valid.
   */
  datasets?: Record<string, readonly string[]> | undefined;
  /** Seed ordering information per TailorDB namespace. */
  namespaces: SeedNamespaceConfig[];
  /** IdP `_User` seeding context, or null when not applicable. */
  idpUser: SeedIdpUserContext | null;
  /**
   * Application the seed's temporary resources are labeled with, or undefined when no single
   * application owns them.
   */
  appName?: string | undefined;
  /**
   * Resolve a machine user given as `<name>` or `<auth>/<name>` to the Auth service it belongs to
   * among the config's Auth services. Always set by {@link loadSeedContext}.
   */
  resolveMachineUser?: (machineUser: string) => AuthInvokerObject;
}

/**
 * Options for {@link loadSeedContext}.
 */
export interface LoadSeedContextOptions {
  /** Path to tailor.config.ts. Defaults to searching from the current directory. */
  configPath?: string | undefined;
  /**
   * Accept tables whose name several TailorDB namespaces define, which a caller tells apart by
   * {@link SeedNamespaceConfig.entityNames}. Without it, such a config is rejected.
   */
  allowSharedTableNames?: boolean | undefined;
}

/**
 * Load the seed context from the local config. Requires `seedPlugin` to be
 * configured in the config's plugins. A relative `distPath` in the seedPlugin
 * options is resolved against the config's directory — the same base
 * `tailor generate` writes it to.
 * @param options - Seed context loading options.
 * @returns The seed context computed from the local config.
 */
export async function loadSeedContext(options: LoadSeedContextOptions = {}): Promise<SeedContext> {
  const { loaded, services, namespaces } = await loadConfigFileNamespaces({
    configPath: options.configPath,
  });
  const config = configOf(loaded);

  assertUniqueLocalTailorDBTypeNames({
    tailorDBServices: services.tailorDBServices,
    groups: tailorDBTypeNameGroupsOf(config),
  });
  const sharedTableNames = namesSharedAcrossNamespaces(
    services.tailorDBServices.map((service) => Object.keys(service.types)),
  );
  if (!options.allowSharedTableNames && sharedTableNames.size > 0) {
    throw locatedCLIError(
      { file: config.path },
      {
        code: "SEED_SHARED_TABLE_NAMES_UNSUPPORTED",
        message: `Several TailorDB namespaces define tables named ${[...sharedTableNames].join(", ")}, which this seed command cannot tell apart.`,
        suggestion: "Upgrade @tailor-platform/sdk-plugin-seed.",
      },
    );
  }

  const pluginOptions = resolvePluginConfig(loaded.plugins, SeedGeneratorID);
  if (!pluginOptions) {
    throw locatedCLIError(
      { file: config.path },
      {
        code: "SEED_PLUGIN_NOT_CONFIGURED",
        message: "seedPlugin is not configured.",
        suggestion:
          'Add seedPlugin({ distPath: "./seed" }) from "@tailor-platform/sdk/plugin/seed" to definePlugins().',
      },
    );
  }
  if (typeof pluginOptions.distPath !== "string" || pluginOptions.distPath === "") {
    throw seedOptionsError({
      file: config.path,
      issue: { path: ["distPath"], message: "Required so seed data has a location." },
      suggestion: 'Pass seedPlugin({ distPath: "./seed" }).',
    });
  }

  // userProfile is only populated once auth namespaces are resolved (the
  // generate flow does the same after loading TailorDB namespaces).
  await Promise.all(services.authServices.map((authService) => authService.resolveNamespaces()));
  let idpUserMeta: ReturnType<typeof soleIdpUser>;
  try {
    idpUserMeta = soleIdpUser(
      Object.fromEntries(
        services.authServices.map((authService) => [
          authService.config.name,
          getAuthInput(authService),
        ]),
      ),
    );
  } catch (error) {
    throw atConfigSource(error, config.path);
  }
  const idpUser: SeedIdpUserContext | null = idpUserMeta
    ? {
        idpNamespace: idpUserMeta.idpNamespace,
        seedScriptCode: generateIdpSeedScriptCode(idpUserMeta.idpNamespace),
        listScriptCode: generateIdpListUsersScriptCode(idpUserMeta.idpNamespace),
        truncateScriptCode: generateIdpTruncateScriptCode(idpUserMeta.idpNamespace),
      }
    : null;

  const auths = machineUserAuths(loaded);
  const distPath = path.resolve(path.dirname(config.path), pluginOptions.distPath);
  const seedNamespaces = buildSeedNamespaceConfigs(namespaces);
  assertNoSharedTableFileUnderItsOwnName(seedNamespaces, path.join(distPath, "data"));
  return {
    config: loaded.kind === "config" ? loaded.config : (config as unknown as LoadedConfig),
    distPath,
    machineUserName: machineUserValue(pluginOptions.machineUserName),
    datasets: parseDatasets(pluginOptions.datasets, config.path),
    namespaces: seedNamespaces,
    idpUser,
    appName: loaded.kind === "config" ? loaded.config.name : undefined,
    resolveMachineUser: (value) => resolveMachineUser({ value, auths }),
  };
}

// A table several namespaces define goes by `<namespace>.<Table>` in seed data, so seeding would
// skip rows still in a file named after the table alone.
function assertNoSharedTableFileUnderItsOwnName(
  namespaces: ReadonlyArray<SeedNamespaceConfig>,
  dataDir: string,
): void {
  const entitiesByTable = new Map<string, string[]>();
  for (const ns of namespaces) {
    for (const [table, entity] of Object.entries(ns.entityNames ?? {})) {
      entitiesByTable.set(table, [...(entitiesByTable.get(table) ?? []), entity]);
    }
  }
  for (const [table, entities] of entitiesByTable) {
    const file = path.join(dataDir, `${table}.jsonl`);
    if (fs.existsSync(file) && fs.readFileSync(file, "utf8").trim() !== "") {
      throw CLIError({
        code: "SEED_DATA_FILE_SHARED_TABLE_NAME",
        message: `${file} holds rows for table "${table}", which several namespaces define.`,
        suggestion: `Move each row to the data file of its namespace's table: ${entities.map((entity) => `${entity}.jsonl`).join(", ")}.`,
        context: { file, table, entities },
      });
    }
  }
}

function machineUserValue(
  machineUser: SeedPluginOptions["machineUserName"] | null,
): string | undefined {
  if (machineUser === null || machineUser === undefined) return undefined;
  return typeof machineUser === "object"
    ? `${machineUser.namespace}/${machineUser.machineUserName}`
    : machineUser;
}

interface SeedOptionsErrorParams {
  /** Config file that configures seedPlugin. */
  file: string;
  /** Rejected option, with its path within the seedPlugin options. */
  issue: FlatIssue;
  /** How to fix the option. */
  suggestion?: string | undefined;
}

function seedOptionsError(params: SeedOptionsErrorParams): CLIError {
  const { file, issue, suggestion } = params;
  return configIssuesError({
    file,
    exportName: "plugins",
    subject: "seedPlugin options",
    issues: [issue],
    suggestion,
  });
}

const DATASET_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

function assertDatasetName(name: string, file: string, issuePath: FlatIssue["path"]): void {
  if (!DATASET_NAME_PATTERN.test(name)) {
    throw seedOptionsError({
      file,
      issue: { path: issuePath, message: `Dataset name "${name}" is invalid.` },
      suggestion: "Use letters, digits, `-` and `_`, starting with a letter or digit.",
    });
  }
}

function parseDatasets(value: unknown, file: string): Record<string, readonly string[]> {
  if (value === undefined) return {};
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw seedOptionsError({
      file,
      issue: {
        path: ["datasets"],
        message: "Must map names to lists of dataset directory names.",
      },
    });
  }
  const datasets: Record<string, readonly string[]> = {};
  for (const [name, directories] of Object.entries(value)) {
    const datasetPath = ["datasets", name];
    assertDatasetName(name, file, datasetPath);
    const notDirectoryNames = () =>
      seedOptionsError({
        file,
        issue: { path: datasetPath, message: "Must be an array of dataset directory names." },
      });
    if (!Array.isArray(directories)) throw notDirectoryNames();
    if (directories.length === 0) {
      throw seedOptionsError({
        file,
        issue: { path: datasetPath, message: "Lists no dataset directories." },
      });
    }
    for (const [index, directory] of directories.entries()) {
      if (typeof directory !== "string") throw notDirectoryNames();
      assertDatasetName(directory, file, [...datasetPath, index]);
    }
    datasets[name] = directories as string[];
  }
  return datasets;
}
