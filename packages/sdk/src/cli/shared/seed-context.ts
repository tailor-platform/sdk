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
import { withErrorDiagnostics } from "./error-diagnostics";
import { CLIError } from "./errors";
import { loadApplicationNamespaces } from "./tailordb-namespaces";
import { configIssuesError } from "./validation-errors";
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
    throw withErrorDiagnostics(
      CLIError({
        code: "SEED_PLUGIN_NOT_CONFIGURED",
        message: "seedPlugin is not configured.",
        suggestion:
          'Add seedPlugin({ distPath: "./seed" }) from "@tailor-platform/sdk/plugin/seed" to definePlugins().',
        context: { file: config.path },
      }),
      { location: { file: config.path } },
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

interface SeedOptionsErrorParams {
  /** Config file that configures seedPlugin. */
  file: string;
  /** Rejected option, with its path within the seedPlugin options. */
  issue: FlatIssue;
  /** How to fix the option. */
  suggestion?: string;
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
