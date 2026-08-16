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
import { workspaceArgs, configArg, DEFAULT_CONFIG_PATH } from "#/cli/shared/args";
import { initOperatorClient } from "#/cli/shared/client";
import { defineAppCommand } from "#/cli/shared/command";
import { extractAllNamespaces } from "#/cli/shared/config";
import { loadConfig, type LoadedConfig } from "#/cli/shared/config-loader";
import { loadAccessToken, loadWorkspaceId } from "#/cli/shared/context";
import { formatCopyableCommand } from "#/cli/shared/errors";
import { logger, styles } from "#/cli/shared/logger";
import { KyselyGeneratorID } from "#/plugin/builtin/kysely-type/index";
import {
  SCRIPT_DB_TYPES_FILE_NAME,
  SCRIPT_SNAPSHOT_FILE_NAME,
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
  }),
  notes: `The scaffolded script is a plain default-exported function; execute it with \`tailor function run <file>\`.

When the project configures \`kyselyTypePlugin\`, the skeleton imports \`getDB()\` from the plugin's generated types. Otherwise the command fetches the namespace's deployed schema and writes a script-scoped \`db.ts\` plus a \`db.snapshot.json\` next to the script; \`function run\` refuses to run the script when that snapshot no longer matches the deployed or locally defined schema.

Re-running the command for an existing script refreshes \`db.ts\` and \`db.snapshot.json\` from the currently deployed schema and leaves the script itself untouched.`,
  examples: [
    {
      cmd: "scripts/fix-prices.ts",
      desc: "Scaffold a one-off script (single-namespace project)",
    },
    {
      cmd: "scripts/fix-prices.ts --namespace tailordb",
      desc: "Scaffold a script targeting a specific namespace",
    },
  ],
  run: async (args) => {
    const filePath = path.resolve(args.file);
    if (!filePath.endsWith(".ts")) {
      throw new Error(`Script path must end with .ts: ${args.file}`);
    }
    const scriptDir = path.dirname(filePath);
    const scriptExists = fs.existsSync(filePath);

    const { config, plugins } = await loadConfig(args.config);
    const kyselyPlugin = plugins.find((plugin) => plugin.id === KyselyGeneratorID);
    const namespace = resolveNamespace({
      config,
      explicit: args.namespace,
      scriptPath: filePath,
      usesKyselyPlugin: kyselyPlugin !== undefined,
    });

    const created: string[] = [];
    let getDBImportPath: string;

    if (kyselyPlugin) {
      if (scriptExists) {
        throw new Error(
          `Script already exists: ${path.relative(process.cwd(), filePath)}. ` +
            "It imports the project's generated Kysely types, so there is nothing to refresh.",
        );
      }
      const generatedTypesPath = resolveKyselyTypesPath(kyselyPlugin, config);
      getDBImportPath = toImportSpecifier(path.relative(scriptDir, generatedTypesPath));
      if (!fs.existsSync(generatedTypesPath)) {
        logger.warn(
          `Generated Kysely types not found at ${styles.path(path.relative(process.cwd(), generatedTypesPath))}. Run \`tailor generate\` before executing the script.`,
        );
      }
    } else {
      const accessToken = await loadAccessToken({ profile: args.profile });
      const client = await initOperatorClient(accessToken);
      const workspaceId = await loadWorkspaceId({
        workspaceId: args["workspace-id"],
        profile: args.profile,
      });

      logger.info(`Fetching deployed schema of namespace ${styles.bold(namespace)}...`);
      const snapshot = await fetchRemoteSchemaSnapshot(client, workspaceId, namespace);
      if (Object.keys(snapshot.tables).length === 0) {
        throw new Error(
          `Namespace "${namespace}" has no deployed tables in workspace ${workspaceId}. ` +
            "Check the namespace name (--namespace) and workspace.",
        );
      }

      const dbTypesPath = path.join(scriptDir, SCRIPT_DB_TYPES_FILE_NAME);
      if (fs.existsSync(dbTypesPath)) {
        const existing = fs.readFileSync(dbTypesPath, "utf-8");
        if (!isGeneratedScriptDbTypes(existing)) {
          throw new Error(
            `Refusing to overwrite ${path.relative(process.cwd(), dbTypesPath)}: ` +
              "it was not generated by `tailor function script`.",
          );
        }
      }
      fs.mkdirSync(scriptDir, { recursive: true });
      fs.writeFileSync(dbTypesPath, generateScriptDbTypes(snapshot));
      created.push(dbTypesPath);
      const snapshotPath = path.join(scriptDir, SCRIPT_SNAPSHOT_FILE_NAME);
      fs.writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2) + "\n");
      created.push(snapshotPath);
      getDBImportPath = "./db";
    }

    if (!scriptExists) {
      fs.mkdirSync(scriptDir, { recursive: true });
      fs.writeFileSync(filePath, generateScriptSkeleton({ getDBImportPath, namespace }));
      created.unshift(filePath);
    }

    const relScript = path.relative(process.cwd(), filePath);
    const runArgv = ["tailor", "function", "run", relScript];
    if (args.config !== DEFAULT_CONFIG_PATH) {
      runArgv.push(`--config=${args.config}`);
    }

    if (logger.jsonMode) {
      logger.out({
        script: filePath,
        created,
        namespace,
        usesGeneratedDbTypes: !kyselyPlugin,
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
  scriptPath: string;
  usesKyselyPlugin: boolean;
}

/**
 * Resolve the target TailorDB namespace for the scaffold.
 * @param options - Resolution inputs
 * @returns The namespace name
 */
function resolveNamespace(options: ResolveNamespaceOptions): string {
  const { config, explicit, scriptPath, usesKyselyPlugin } = options;
  const configured = extractAllNamespaces(config);

  if (explicit) {
    if (usesKyselyPlugin && !configured.includes(explicit)) {
      throw new Error(
        `Namespace "${explicit}" is not defined in the config, so the project's generated Kysely types do not cover it.` +
          (configured.length > 0 ? ` Available namespaces: ${configured.join(", ")}` : ""),
      );
    }
    return explicit;
  }

  const sidecar = usesKyselyPlugin ? null : loadScriptSchemaSnapshot(scriptPath);
  if (sidecar) {
    return sidecar.snapshot.namespace;
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
  throw new Error(
    "No TailorDB namespace is defined in the config. Specify the deployed namespace with --namespace.",
  );
}

/**
 * Resolve the absolute path of the kysely-type plugin's generated types file.
 * @param plugin - The configured kysely-type plugin instance
 * @param config - Loaded config (for the config directory)
 * @returns Absolute path of the generated types file
 */
function resolveKyselyTypesPath(plugin: Plugin, config: LoadedConfig): string {
  const distPath = (plugin as { pluginConfig?: { distPath?: unknown } }).pluginConfig?.distPath;
  if (typeof distPath !== "string" || distPath.length === 0) {
    throw new Error("kyselyTypePlugin is configured without a distPath; cannot locate getDB().");
  }
  return path.resolve(path.dirname(config.path), distPath);
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
