/**
 * `tailor function scaffold` command
 *
 * Scaffolds a one-off script that `tailor function run` executes on the
 * Tailor Platform server without deploying.
 */

import * as fs from "node:fs";
import { arg } from "@politty/zod";
import * as path from "pathe";
import { z } from "zod";
import { fetchRemoteSchemaSnapshot } from "#/cli/commands/tailordb/migrate/schema-checks";
import {
  createSnapshotFromLocalTypes,
  type NormalizedSchemaSnapshot,
} from "#/cli/commands/tailordb/migrate/snapshot";
import { workspaceArgs, configArg, formatConfigArg } from "#/cli/shared/args";
import { defineAppCommand } from "#/cli/shared/command";
import { configOf, declaredNamespaces, ownedNamespaces } from "#/cli/shared/config-file";
import { loadConfigFile, type LoadedConfigFile } from "#/cli/shared/config-loader";
import { CLIError, formatCommandHint } from "#/cli/shared/errors";
import { logger, styles } from "#/cli/shared/logger";
import { loadOperatorWorkspaceContext } from "#/cli/shared/operator-context";
import { loadTailorDBNamespaces, loadWorkspaceNamespaces } from "#/cli/shared/tailordb-namespaces";
import { KyselyGeneratorID } from "#/plugin/builtin/kysely-type/index";
import { resolvePluginConfig } from "#/plugin/get-plugin-config";
import { assertDefined } from "#/utils/assert";
import {
  SCRIPT_DB_TYPES_FILE_NAME,
  SCRIPT_SNAPSHOT_FILE_NAME,
  assertGeneratedTypeScript,
  generateScriptDbTypes,
  generateScriptSkeleton,
  isGeneratedScriptDbTypes,
  loadScriptSchemaSnapshot,
} from "./script-scaffold";
import type { Plugin } from "#/plugin/types";

export const scaffoldCommand = defineAppCommand({
  name: "scaffold",
  aliases: ["script"],
  description: "Scaffold a one-off script to run with `function run`.",
  // strip unknown keys
  args: z.object({
    ...workspaceArgs,
    ...configArg,
    file: arg(z.string(), {
      positional: true,
      description: "Path to create the script at (must end with .ts)",
    }),
    namespace: arg(z.string().optional(), {
      description: "Target TailorDB namespace (required when the config does not pin one)",
    }),
    remote: arg(z.boolean().default(false), {
      description: "Generate script-scoped DB types from the deployed schema",
    }),
  }),
  notes: `The scaffolded script is a plain default-exported function; execute it with \`tailor function run <file>\`.

By default, when the project configures \`kyselyTypePlugin\`, the skeleton imports \`getDB()\` from the plugin's generated types, or from \`@tailor-platform/sdk/plugin/kysely-type/db\` when the plugin sets \`contentMapper: true\`. Without the plugin, the command uses the namespace's local table definitions to write a script-scoped \`db.ts\` plus a \`db.snapshot.json\` next to the script; \`function run\` refuses to run the script when that snapshot no longer matches the deployed or locally defined table and field structure.

Pass \`--remote\` to generate the script-scoped files from the deployed schema instead, even when \`kyselyTypePlugin\` is configured. This is required for an external namespace. Re-running the command refreshes \`db.ts\` and \`db.snapshot.json\` from the selected source and leaves the script itself untouched.

\`script\` is a deprecated alias of this command and will be removed in v3.`,
  examples: [
    {
      cmd: "scripts/fix-prices.ts",
      desc: "Scaffold a one-off script (single-namespace project)",
    },
    {
      cmd: "scripts/fix-prices.ts --namespace tailordb",
      desc: "Scaffold a script targeting a specific namespace",
    },
    {
      cmd: "scripts/fix-prices.ts --namespace shared --remote",
      desc: "Scaffold from a deployed or external namespace",
    },
  ],
  run: async (args) => {
    if (args.$invocation?.name === "script") {
      logger.warn(
        "`tailor function script` is deprecated and will be removed in v3. Use `tailor function scaffold` instead.",
      );
    }

    const filePath = path.resolve(args.file);
    if (!filePath.endsWith(".ts")) {
      throw CLIError({
        code: "SCRIPT_PATH_INVALID",
        message: `Script path must end with .ts: ${args.file}`,
        command: "function scaffold",
      });
    }
    const scriptDir = path.dirname(filePath);
    const scriptExists = fs.existsSync(filePath);
    const dbTypesPath = path.join(scriptDir, SCRIPT_DB_TYPES_FILE_NAME);
    const snapshotPath = path.join(scriptDir, SCRIPT_SNAPSHOT_FILE_NAME);
    if (filePath === dbTypesPath) {
      throw CLIError({
        code: "SCRIPT_PATH_INVALID",
        message: `${SCRIPT_DB_TYPES_FILE_NAME} is reserved for the generated Kysely types written next to the script. Choose a different script file name.`,
        command: "function scaffold",
      });
    }

    const loaded = await loadConfigFile(args.config);
    const config = configOf(loaded);
    const { plugins } = loaded;
    const kyselyPlugin = plugins.find((plugin) => plugin.id === KyselyGeneratorID);
    const hasSnapshotSidecar = fs.existsSync(snapshotPath);
    if (args.remote && kyselyPlugin !== undefined && scriptExists && !hasSnapshotSidecar) {
      throw CLIError({
        code: "SCRIPT_EXISTS",
        message: `Script already exists: ${path.relative(process.cwd(), filePath)}.`,
        suggestion:
          "Scaffold --remote at a new path so the generated script imports its script-scoped db.ts.",
      });
    }
    // A directory that already carries a snapshot sidecar keeps using
    // script-scoped generated types, even when the project has since
    // configured kyselyTypePlugin: its scripts import ./db.
    const useGeneratedDbTypes = args.remote || kyselyPlugin === undefined || hasSnapshotSidecar;

    let existingSidecarNamespace: string | undefined;
    if (useGeneratedDbTypes) {
      try {
        existingSidecarNamespace = loadScriptSchemaSnapshot(filePath)?.snapshot.namespace;
      } catch {
        // A corrupt sidecar is regenerated below; resolve from the config instead.
      }
    }
    const namespace = resolveNamespace({
      loaded,
      explicit: args.namespace,
      sidecarNamespace: existingSidecarNamespace,
      remote: args.remote,
    });
    if (existingSidecarNamespace !== undefined && existingSidecarNamespace !== namespace) {
      throw CLIError({
        code: "SCRIPT_NAMESPACE_MISMATCH",
        message: `This directory's generated types target namespace "${existingSidecarNamespace}" (${SCRIPT_SNAPSHOT_FILE_NAME}).`,
        suggestion: `Scaffold scripts for namespace "${namespace}" in a separate directory.`,
      });
    }

    const created: string[] = [];
    let getDBImportPath: string;
    let resolvedWorkspaceId: string | undefined;

    if (!useGeneratedDbTypes) {
      if (scriptExists) {
        throw CLIError({
          code: "SCRIPT_EXISTS",
          message: `Script already exists: ${path.relative(process.cwd(), filePath)}.`,
          suggestion:
            "It imports the project's generated Kysely types, so there is nothing to refresh.",
        });
      }
      const { specifier, generatedFile } = resolveKyselyTypesImport(
        plugins,
        config.path,
        scriptDir,
      );
      getDBImportPath = specifier;
      if (generatedFile !== undefined && !fs.existsSync(generatedFile)) {
        logger.warn(
          `Generated Kysely types not found at ${styles.path(path.relative(process.cwd(), generatedFile))}. Run \`tailor generate\` before executing the script.`,
        );
      }
    } else {
      let snapshot: NormalizedSchemaSnapshot;
      if (args.remote) {
        const { client, workspaceId } = await loadOperatorWorkspaceContext({
          profile: args.profile,
          workspaceId: args["workspace-id"],
        });
        resolvedWorkspaceId = workspaceId;

        logger.info(`Fetching deployed schema of namespace ${styles.bold(namespace)}...`);
        snapshot = await fetchRemoteSchemaSnapshot(client, workspaceId, namespace);
      } else {
        logger.info(`Loading local definitions of namespace ${styles.bold(namespace)}...`);
        const namespaces =
          loaded.kind === "workspace"
            ? await loadWorkspaceNamespaces(loaded.workspace, plugins, { namespaces: [namespace] })
            : (await loadTailorDBNamespaces({ configPath: args.config, namespaces: [namespace] }))
                .namespaces;
        const namespaceData = assertDefined(namespaces[0], `namespace ${namespace}`);
        snapshot = createSnapshotFromLocalTypes(namespaceData.tables, namespace);
      }
      if (Object.keys(snapshot.tables).length === 0) {
        const sourceDescription = args.remote
          ? `deployed tables in workspace ${assertDefined(resolvedWorkspaceId, "workspace ID")}`
          : "locally defined tables";
        throw CLIError({
          code: "SCRIPT_SCHEMA_NOT_FOUND",
          message: `Namespace "${namespace}" has no ${sourceDescription}.`,
        });
      }

      if (fs.existsSync(dbTypesPath)) {
        const existing = fs.readFileSync(dbTypesPath, "utf-8");
        if (!isGeneratedScriptDbTypes(existing)) {
          throw CLIError({
            code: "GENERATED_TYPES_NOT_OWNED",
            message:
              `Refusing to overwrite ${path.relative(process.cwd(), dbTypesPath)}: ` +
              "it was not generated by `tailor function scaffold`.",
          });
        }
      }
      const dbTypesContent = generateScriptDbTypes(
        snapshot,
        resolvePluginConfig(plugins, KyselyGeneratorID)?.temporal ?? false,
      );
      assertGeneratedTypeScript(dbTypesPath, dbTypesContent);
      fs.mkdirSync(scriptDir, { recursive: true });
      fs.writeFileSync(dbTypesPath, dbTypesContent);
      created.push(dbTypesPath);
      fs.writeFileSync(
        snapshotPath,
        JSON.stringify({ ...snapshot, source: args.remote ? "remote" : "local" }, null, 2) + "\n",
      );
      created.push(snapshotPath);
      getDBImportPath = "./db";
    }

    if (!scriptExists) {
      const skeleton = generateScriptSkeleton({ getDBImportPath, namespace });
      assertGeneratedTypeScript(filePath, skeleton);
      fs.mkdirSync(scriptDir, { recursive: true });
      fs.writeFileSync(filePath, skeleton);
      created.unshift(filePath);
    }

    const relScript = path.relative(process.cwd(), filePath);
    const runArgs = ["function", "run", relScript];
    const configHint = formatConfigArg(args.config);
    if (configHint !== undefined) {
      runArgs.push(configHint);
    }
    const workspaceIdForHint = resolvedWorkspaceId ?? args["workspace-id"];
    if (workspaceIdForHint !== undefined) {
      runArgs.push(`--workspace-id=${workspaceIdForHint}`);
    }
    if (args.profile !== undefined) {
      runArgs.push(`--profile=${args.profile}`);
    }

    if (logger.jsonMode) {
      logger.out({
        script: filePath,
        created,
        namespace,
        usesGeneratedDbTypes: useGeneratedDbTypes,
      });
      return;
    }

    if (scriptExists) {
      logger.info(`Script already exists; refreshed generated types only.`);
    }
    for (const file of created) {
      logger.success(`Created ${styles.path(path.relative(process.cwd(), file))}`);
    }
    logger.info(
      `Next: edit the script, then run ${formatCommandHint({ command: "tailor", args: runArgs })}`,
    );
  },
});

interface ResolveNamespaceOptions {
  loaded: LoadedConfigFile;
  explicit: string | undefined;
  sidecarNamespace: string | undefined;
  remote: boolean;
}

/**
 * Resolve the target TailorDB namespace for the scaffold.
 * @param options - Resolution inputs
 * @returns The namespace name
 */
function resolveNamespace(options: ResolveNamespaceOptions): string {
  const { loaded, explicit, sidecarNamespace, remote } = options;
  const allNamespaces = declaredNamespaces(loaded);
  const owned = ownedNamespaces(loaded);
  const configured = remote ? allNamespaces : owned;

  if (explicit) {
    if (!remote && !owned.includes(explicit)) {
      throw CLIError({
        code: "SCRIPT_NAMESPACE_REQUIRES_REMOTE",
        message: `Namespace "${explicit}" is not owned by the config and requires --remote.`,
        command: "function scaffold",
      });
    }
    return explicit;
  }

  if (sidecarNamespace !== undefined) {
    if (!remote && !owned.includes(sidecarNamespace)) {
      throw CLIError({
        code: "SCRIPT_NAMESPACE_REQUIRES_REMOTE",
        message: `Namespace "${sidecarNamespace}" is not owned by the config and requires --remote.`,
        command: "function scaffold",
      });
    }
    return sidecarNamespace;
  }

  if (configured.length === 1) {
    const namespace = configured[0];
    if (namespace !== undefined) return namespace;
  }
  if (configured.length > 1) {
    throw CLIError({
      code: "TAILORDB_NAMESPACE_REQUIRED",
      message: `Multiple TailorDB namespaces are defined (${configured.join(", ")}). Specify one with --namespace.`,
      command: "function scaffold",
    });
  }
  if (!remote && allNamespaces.length > 0) {
    throw CLIError({
      code: "TAILORDB_NAMESPACE_NOT_CONFIGURED",
      message: `No owned TailorDB namespace is defined in the config. External namespaces require --remote: ${allNamespaces.join(", ")}.`,
    });
  }
  throw CLIError({
    code: "TAILORDB_NAMESPACE_NOT_CONFIGURED",
    message: "No TailorDB namespace is defined in the config.",
  });
}

const SDK_KYSELY_DB_SPECIFIER = "@tailor-platform/sdk/plugin/kysely-type/db";

/**
 * Resolve where a script imports `getDB()` from when the project configures `kyselyTypePlugin`.
 * A configured `distPath` is a generated types file, which resolves against the config's
 * directory like where `tailor generate` writes it; with `contentMapper: true`, the SDK provides `getDB()`.
 * @param plugins - The project's configured plugins
 * @param configPath - Path of the config that configures the plugins
 * @param scriptDir - Directory the script is written to
 * @returns The import specifier, and the generated types file it points at when there is one
 */
function resolveKyselyTypesImport(
  plugins: readonly Plugin[],
  configPath: string,
  scriptDir: string,
): { specifier: string; generatedFile?: string } {
  const options = resolvePluginConfig(plugins, KyselyGeneratorID);
  const distPath = options?.distPath;
  if (options?.contentMapper === true) return { specifier: SDK_KYSELY_DB_SPECIFIER };
  if (!distPath) {
    throw CLIError({
      code: "KYSELY_TYPE_PLUGIN_INVALID",
      message:
        "kyselyTypePlugin is configured without a distPath or contentMapper: true; cannot locate getDB().",
    });
  }
  const generatedFile = path.resolve(path.dirname(configPath), distPath);
  return {
    specifier: toImportSpecifier(path.relative(scriptDir, generatedFile)),
    generatedFile,
  };
}

/**
 * Convert a relative file path into a TypeScript import specifier.
 * @param relativePath - Path relative to the importing file's directory
 * @returns Import specifier with a ./ prefix and no .ts extension
 */
function toImportSpecifier(relativePath: string): string {
  const withoutExt = relativePath.replace(/\.ts$/, "");
  return withoutExt.startsWith(".") ? withoutExt : `./${withoutExt}`;
}
