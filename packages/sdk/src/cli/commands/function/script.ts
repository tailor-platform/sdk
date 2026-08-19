/**
 * `tailor function script` command
 *
 * Scaffolds a one-off script that `tailor function run` executes on the
 * Tailor Platform server without deploying.
 */

import * as fs from "node:fs";
import * as path from "pathe";
import { arg } from "politty";
import { z } from "zod";
import { fetchRemoteSchemaSnapshot } from "#/cli/commands/tailordb/migrate/schema-checks";
import {
  createSnapshotFromLocalTypes,
  type NormalizedSchemaSnapshot,
} from "#/cli/commands/tailordb/migrate/snapshot";
import { workspaceArgs, configArg, DEFAULT_CONFIG_PATH } from "#/cli/shared/args";
import { initOperatorClient } from "#/cli/shared/client";
import { defineAppCommand } from "#/cli/shared/command";
import { extractAllNamespaces, extractOwnedNamespaces } from "#/cli/shared/config";
import { loadConfig, type LoadedConfig } from "#/cli/shared/config-loader";
import { loadAccessToken, loadWorkspaceId } from "#/cli/shared/context";
import { formatCopyableCommand } from "#/cli/shared/errors";
import { logger, styles } from "#/cli/shared/logger";
import { loadTailorDBNamespaces } from "#/cli/shared/tailordb-namespaces";
import { KyselyGeneratorID } from "#/plugin/builtin/kysely-type/index";
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

export const scriptCommand = defineAppCommand({
  name: "script",
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

By default, when the project configures \`kyselyTypePlugin\`, the skeleton imports \`getDB()\` from the plugin's generated types. Without the plugin, the command uses the namespace's local table definitions to write a script-scoped \`db.ts\` plus a \`db.snapshot.json\` next to the script; \`function run\` refuses to run the script when that snapshot no longer matches the deployed or locally defined table and field structure.

Pass \`--remote\` to generate the script-scoped files from the deployed schema instead, even when \`kyselyTypePlugin\` is configured. This is required for an external namespace. Re-running the command refreshes \`db.ts\` and \`db.snapshot.json\` from the selected source and leaves the script itself untouched.`,
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
    const filePath = path.resolve(args.file);
    if (!filePath.endsWith(".ts")) {
      throw new Error(`Script path must end with .ts: ${args.file}`);
    }
    const scriptDir = path.dirname(filePath);
    const scriptExists = fs.existsSync(filePath);
    const dbTypesPath = path.join(scriptDir, SCRIPT_DB_TYPES_FILE_NAME);
    const snapshotPath = path.join(scriptDir, SCRIPT_SNAPSHOT_FILE_NAME);
    if (filePath === dbTypesPath) {
      throw new Error(
        `${SCRIPT_DB_TYPES_FILE_NAME} is reserved for the generated Kysely types written next to the script. Choose a different script file name.`,
      );
    }

    const { config, plugins } = await loadConfig(args.config);
    const kyselyPlugin = plugins.find((plugin) => plugin.id === KyselyGeneratorID);
    const hasSnapshotSidecar = fs.existsSync(snapshotPath);
    if (args.remote && kyselyPlugin !== undefined && scriptExists && !hasSnapshotSidecar) {
      throw new Error(
        `Script already exists: ${path.relative(process.cwd(), filePath)}. ` +
          "Scaffold --remote at a new path so the generated script imports its script-scoped db.ts.",
      );
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
      config,
      explicit: args.namespace,
      sidecarNamespace: existingSidecarNamespace,
      remote: args.remote,
    });
    if (existingSidecarNamespace !== undefined && existingSidecarNamespace !== namespace) {
      throw new Error(
        `This directory's generated types target namespace "${existingSidecarNamespace}" (${SCRIPT_SNAPSHOT_FILE_NAME}). ` +
          `Scaffold scripts for namespace "${namespace}" in a separate directory.`,
      );
    }

    const created: string[] = [];
    let getDBImportPath: string;
    let resolvedWorkspaceId: string | undefined;

    if (!useGeneratedDbTypes) {
      if (scriptExists) {
        throw new Error(
          `Script already exists: ${path.relative(process.cwd(), filePath)}. ` +
            "It imports the project's generated Kysely types, so there is nothing to refresh.",
        );
      }
      const generatedTypesPath = resolveKyselyTypesPath(assertDefined(kyselyPlugin, "plugin"));
      getDBImportPath = toImportSpecifier(path.relative(scriptDir, generatedTypesPath));
      if (!fs.existsSync(generatedTypesPath)) {
        logger.warn(
          `Generated Kysely types not found at ${styles.path(path.relative(process.cwd(), generatedTypesPath))}. Run \`tailor generate\` before executing the script.`,
        );
      }
    } else {
      let snapshot: NormalizedSchemaSnapshot;
      if (args.remote) {
        const accessToken = await loadAccessToken({ profile: args.profile });
        const client = await initOperatorClient(accessToken);
        const workspaceId = await loadWorkspaceId({
          workspaceId: args["workspace-id"],
          profile: args.profile,
        });
        resolvedWorkspaceId = workspaceId;

        logger.info(`Fetching deployed schema of namespace ${styles.bold(namespace)}...`);
        snapshot = await fetchRemoteSchemaSnapshot(client, workspaceId, namespace);
      } else {
        logger.info(`Loading local definitions of namespace ${styles.bold(namespace)}...`);
        const { namespaces } = await loadTailorDBNamespaces({
          configPath: args.config,
          namespaces: [namespace],
        });
        const namespaceData = assertDefined(namespaces[0], `namespace ${namespace}`);
        snapshot = createSnapshotFromLocalTypes(namespaceData.tables, namespace);
      }
      if (Object.keys(snapshot.tables).length === 0) {
        const sourceDescription = args.remote
          ? `deployed tables in workspace ${assertDefined(resolvedWorkspaceId, "workspace ID")}`
          : "locally defined tables";
        throw new Error(`Namespace "${namespace}" has no ${sourceDescription}.`);
      }

      if (fs.existsSync(dbTypesPath)) {
        const existing = fs.readFileSync(dbTypesPath, "utf-8");
        if (!isGeneratedScriptDbTypes(existing)) {
          throw new Error(
            `Refusing to overwrite ${path.relative(process.cwd(), dbTypesPath)}: ` +
              "it was not generated by `tailor function script`.",
          );
        }
      }
      const dbTypesContent = generateScriptDbTypes(snapshot);
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
    const runArgv = ["tailor", "function", "run", relScript];
    if (args.config !== DEFAULT_CONFIG_PATH) {
      runArgv.push(`--config=${args.config}`);
    }
    const workspaceIdForHint = resolvedWorkspaceId ?? args["workspace-id"];
    if (workspaceIdForHint !== undefined) {
      runArgv.push(`--workspace-id=${workspaceIdForHint}`);
    }
    if (args.profile !== undefined) {
      runArgv.push(`--profile=${args.profile}`);
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
    logger.info(`Next: edit the script, then run ${formatCopyableCommand(runArgv)}`);
  },
});

interface ResolveNamespaceOptions {
  config: LoadedConfig;
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
  const { config, explicit, sidecarNamespace, remote } = options;
  const allNamespaces = extractAllNamespaces(config);
  const ownedNamespaces = extractOwnedNamespaces(config);
  const configured = remote ? allNamespaces : ownedNamespaces;

  if (explicit) {
    if (!remote && !ownedNamespaces.includes(explicit)) {
      throw new Error(`Namespace "${explicit}" is not owned by the config and requires --remote.`);
    }
    return explicit;
  }

  if (sidecarNamespace !== undefined) {
    if (!remote && !ownedNamespaces.includes(sidecarNamespace)) {
      throw new Error(
        `Namespace "${sidecarNamespace}" is not owned by the config and requires --remote.`,
      );
    }
    return sidecarNamespace;
  }

  if (configured.length === 1) {
    const namespace = configured[0];
    if (namespace !== undefined) return namespace;
  }
  if (configured.length > 1) {
    throw new Error(
      `Multiple TailorDB namespaces are defined (${configured.join(", ")}). Specify one with --namespace.`,
    );
  }
  if (!remote && allNamespaces.length > 0) {
    throw new Error(
      `No owned TailorDB namespace is defined in the config. External namespaces require --remote: ${allNamespaces.join(", ")}.`,
    );
  }
  throw new Error("No TailorDB namespace is defined in the config.");
}

/**
 * Resolve the absolute path of the kysely-type plugin's generated types file.
 * The plugin's relative `distPath` resolves against the working directory,
 * matching where `tailor generate` writes it.
 * @param plugin - The configured kysely-type plugin instance
 * @returns Absolute path of the generated types file
 */
function resolveKyselyTypesPath(plugin: Plugin): string {
  const distPath = (plugin as { pluginConfig?: { distPath?: unknown } }).pluginConfig?.distPath;
  if (typeof distPath !== "string" || distPath.length === 0) {
    throw new Error("kyselyTypePlugin is configured without a distPath; cannot locate getDB().");
  }
  return path.resolve(distPath);
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
