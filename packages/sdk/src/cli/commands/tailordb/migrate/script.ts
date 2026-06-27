/**
 * Script command for TailorDB migrations
 *
 * Adds a `migrate.ts` (and supporting `db.ts`) template to an existing
 * migration directory. Useful for warning-tier changes where users may
 * want to write a custom data migration even though the change does not
 * automatically require one.
 */

import * as fs from "node:fs";
import * as fsPromises from "node:fs/promises";
import * as path from "pathe";
import { arg } from "politty";
import { z } from "zod";
import { configArg } from "#/cli/shared/args";
import { logBetaWarning } from "#/cli/shared/beta";
import { defineAppCommand } from "#/cli/shared/command";
import { loadConfig } from "#/cli/shared/config-loader";
import { getConfiguredEditorCommand, openInConfiguredEditor } from "#/cli/shared/editor";
import { logger, styles } from "#/cli/shared/logger";
import { assertDefined } from "#/utils/assert";
import { getNamespacesWithMigrations, type NamespaceWithMigrations } from "./config";
import { writeDbTypesFile } from "./db-types-generator";
import { parseMigrationNumberArg } from "./migration-number";
import {
  getMigrationFilePath,
  loadDiff,
  reconstructSnapshotFromMigrations,
  INITIAL_SCHEMA_NUMBER,
} from "./snapshot";
import { generateMigrationScript } from "./template-generator";

export interface ScriptOptions {
  configPath?: string;
  number: string;
  namespace?: string;
}

/**
 * Add a migrate.ts template to an existing migration directory.
 * @param {ScriptOptions} options - Command options
 */
async function script(options: ScriptOptions): Promise<void> {
  logBetaWarning("tailordb migration");

  const migrationNumber = parseMigrationNumberArg(options.number);

  if (migrationNumber === INITIAL_SCHEMA_NUMBER) {
    throw new Error(
      `Migration ${options.number} is the initial schema snapshot and cannot have a migration script.`,
    );
  }

  const { config } = await loadConfig(options.configPath);
  const configDir = path.dirname(config.path);

  const namespacesWithMigrations = getNamespacesWithMigrations(config, configDir);
  if (namespacesWithMigrations.length === 0) {
    throw new Error("No TailorDB services with migrations configuration found");
  }

  const targetNamespace = resolveTargetNamespace(namespacesWithMigrations, options.namespace);
  const { migrationsDir } = assertDefined(
    namespacesWithMigrations.find((ns) => ns.namespace === targetNamespace),
    "namespace with migrations not found",
  );

  const diffPath = getMigrationFilePath(migrationsDir, migrationNumber, "diff");
  if (!fs.existsSync(diffPath)) {
    throw new Error(
      `Migration ${options.number} not found in ${migrationsDir}. Expected ${diffPath}.`,
    );
  }

  const migratePath = getMigrationFilePath(migrationsDir, migrationNumber, "migrate");
  if (fs.existsSync(migratePath)) {
    throw new Error(`Migration script already exists at ${migratePath}.`);
  }

  const diff = loadDiff(diffPath);

  // Reconstruct the schema state immediately before this migration so that
  // db.ts has Kysely types for the previous shape of the data.
  const previousSnapshot = reconstructSnapshotFromMigrations(migrationsDir, migrationNumber - 1);
  if (!previousSnapshot) {
    throw new Error(
      `Could not reconstruct previous schema for migration ${options.number}. Make sure migration ${INITIAL_SCHEMA_NUMBER} exists.`,
    );
  }

  const scriptContent = generateMigrationScript(diff);
  await fsPromises.writeFile(migratePath, scriptContent);
  await writeDbTypesFile(previousSnapshot, migrationsDir, migrationNumber, diff);

  logger.success(
    `Added migration script for migration ${styles.bold(options.number)} in namespace ${styles.bold(targetNamespace)}`,
  );
  logger.info(`  Migration script: ${migratePath}`);
  logger.info(`  DB types: ${getMigrationFilePath(migrationsDir, migrationNumber, "db")}`);

  logger.newline();
  logger.log("Edit the script to implement your data migration logic.");
  logger.log("It will be executed by 'tailor-sdk deploy' between Pre and Post phases.");

  const editor = getConfiguredEditorCommand();
  if (!editor) return;

  logger.newline();
  logger.info(`Opening ${path.basename(migratePath)} in ${editor}...`);
  try {
    await openInConfiguredEditor(migratePath);
  } catch {
    return;
  }
}

function resolveTargetNamespace(
  namespacesWithMigrations: NamespaceWithMigrations[],
  requested?: string,
): string {
  if (requested) {
    if (!namespacesWithMigrations.some((ns) => ns.namespace === requested)) {
      throw new Error(`Namespace "${requested}" not found or does not have migrations configured`);
    }
    return requested;
  }
  if (namespacesWithMigrations.length === 1) {
    const [ns] = namespacesWithMigrations;
    return assertDefined(ns, "namespace with migrations missing").namespace;
  }
  throw new Error(
    `Multiple TailorDB services found. Please specify namespace with --namespace flag: ${namespacesWithMigrations.map((ns) => ns.namespace).join(", ")}`,
  );
}

export const scriptCommand = defineAppCommand({
  name: "script",
  description: "Add a migration script (migrate.ts) template to an existing migration directory.",
  args: z.strictObject({
    ...configArg,
    number: arg(z.string(), {
      positional: true,
      description: "Migration number to add a script to (e.g., 0001 or 1)",
    }),
    namespace: arg(z.string().optional(), {
      alias: "n",
      description: "Target TailorDB namespace (required if multiple namespaces exist)",
    }),
  }),
  run: async (args) => {
    await script({
      configPath: args.config,
      number: args.number,
      namespace: args.namespace,
    });
  },
});
