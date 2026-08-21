import * as path from "pathe";
import { assertDefined } from "#/utils/assert";
import { processIdpUser, generateIdpUserSchemaFile } from "./idp-user-processor";
import {
  processLinesDb,
  generateLinesDbSchemaFile,
  generateLinesDbSchemaFileWithPluginAPI,
  type PluginSchemaParams,
} from "./lines-db-processor";
import type { Plugin, GeneratorResult, TailorDBReadyContext } from "#/plugin/types";

/** Unique identifier for the seed generator plugin. */
export const SeedGeneratorID = "@tailor-platform/seed";

type DisableIdpUserSyncDirections = {
  /**
   * Skip emitting the foreign key from `<userProfile>.<usernameField>` to
   * `_User.name`. Defaults to `false` (FK emitted).
   *
   * Set to `true` to seed pre-registration states such as
   * invited-but-not-registered users.
   */
  userToIdp?: boolean;
  /**
   * Skip emitting the foreign key from `_User.name` to
   * `<userProfile>.<usernameField>`. Defaults to `false` (FK emitted).
   *
   * Set to `true` to seed `_User` rows that do not yet have a corresponding
   * userProfile row.
   */
  idpToUser?: boolean;
};

export type SeedPluginOptions = {
  distPath: string;
  machineUserName?: string;
  /**
   * Disable individual `_User <-> userProfile` foreign keys emitted into
   * the generated seed schema. Both directions are emitted by default.
   *
   * Set a direction to `true` to relax it — for example to seed invited
   * users that do not yet have an IdP credential.
   */
  disableIdpUserSync?: DisableIdpUserSyncDirections;
};

function resolveIdpUserSyncFKs(option: SeedPluginOptions["disableIdpUserSync"]): {
  emitUserToIdpFK: boolean;
  emitIdpToUserFK: boolean;
} {
  return {
    emitUserToIdpFK: !(option?.userToIdp ?? false),
    emitIdpToUserFK: !(option?.idpToUser ?? false),
  };
}
/**
 * Plugin that generates seed data and schema files consumed by the
 * `tailor seed` commands (@tailor-platform/sdk-plugin-seed).
 * @param options - Plugin options
 * @param options.distPath - Output directory path for generated seed files
 * @param options.machineUserName - Default machine user name for authentication
 * @param options.disableIdpUserSync - Skip emitting individual `_User <-> userProfile` foreign keys. Both directions are emitted by default; set a direction to `true` to relax that side.
 * @returns Plugin instance with onTailorDBReady hook
 */
export function seedPlugin(options: SeedPluginOptions): Plugin<unknown, SeedPluginOptions> {
  return {
    id: SeedGeneratorID,
    description: "Generates seed data and schema files for the tailor seed CLI plugin",
    pluginConfig: options,

    async onTailorDBReady(ctx: TailorDBReadyContext<SeedPluginOptions>): Promise<GeneratorResult> {
      const files: GeneratorResult["files"] = [];

      // Process IdP user early so we can add reverse FK to the user profile type
      const idpUser = ctx.auth ? (processIdpUser(ctx.auth) ?? null) : null;
      const idpUserSyncFKs = resolveIdpUserSyncFKs(ctx.pluginConfig.disableIdpUserSync);

      for (const ns of ctx.tailordb) {
        for (const [tableName, type] of Object.entries(ns.tables)) {
          const source = assertDefined(
            ns.sourceInfo.get(tableName),
            `source info missing for table: ${tableName}`,
          );
          const linesDb = processLinesDb(type, source);

          // Add reverse FK from userProfile table to _User (opt-out via disableIdpUserSync.userToIdp: true)
          if (
            idpUserSyncFKs.emitUserToIdpFK &&
            idpUser &&
            tableName === idpUser.schema.userTableName
          ) {
            linesDb.foreignKeys.push({
              column: idpUser.schema.usernameField,
              references: {
                table: "_User",
                column: "name",
              },
            });
          }

          // Generate empty JSONL data file
          files.push({
            path: path.join(ctx.pluginConfig.distPath, "data", `${linesDb.tableName}.jsonl`),
            content: "",
            skipIfExists: true,
          });

          const schemaOutputPath = path.join(
            ctx.pluginConfig.distPath,
            "data",
            `${linesDb.tableName}.schema.ts`,
          );

          // Plugin-generated table: use getGeneratedTable API
          if (linesDb.pluginSource && linesDb.pluginSource.pluginImportPath) {
            // Build original type import path
            let originalImportPath: string | undefined;
            if (linesDb.pluginSource.originalFilePath && linesDb.pluginSource.originalExportName) {
              const relativePath = path.relative(
                path.dirname(schemaOutputPath),
                linesDb.pluginSource.originalFilePath,
              );
              originalImportPath = relativePath.replace(/\.ts$/, "").startsWith(".")
                ? relativePath.replace(/\.ts$/, "")
                : `./${relativePath.replace(/\.ts$/, "")}`;
            }

            // Compute relative path from schema output to config file
            const configImportPath = path.relative(path.dirname(schemaOutputPath), ctx.configPath);

            const params: PluginSchemaParams = {
              configImportPath,
              originalImportPath,
            };

            const schemaContent = generateLinesDbSchemaFileWithPluginAPI(linesDb, params);

            files.push({
              path: schemaOutputPath,
              content: schemaContent,
            });
          } else {
            // User-defined type: import from source file
            const relativePath = path.relative(path.dirname(schemaOutputPath), linesDb.importPath);
            const typeImportPath = relativePath.replace(/\.ts$/, "").startsWith(".")
              ? relativePath.replace(/\.ts$/, "")
              : `./${relativePath.replace(/\.ts$/, "")}`;
            const schemaContent = generateLinesDbSchemaFile(linesDb, typeImportPath);

            files.push({
              path: schemaOutputPath,
              content: schemaContent,
            });
          }
        }
      }

      if (idpUser) {
        // Generate empty JSONL data file
        files.push({
          path: path.join(ctx.pluginConfig.distPath, idpUser.dataFile),
          content: "",
          skipIfExists: true,
        });

        // Generate schema file with foreign key (opt-out via disableIdpUserSync.idpToUser: true)
        files.push({
          path: path.join(ctx.pluginConfig.distPath, "data", `${idpUser.name}.schema.ts`),
          content: generateIdpUserSchemaFile({
            usernameField: idpUser.schema.usernameField,
            userTableName: idpUser.schema.userTableName,
            includeUserProfileFK: idpUserSyncFKs.emitIdpToUserFK,
          }),
        });
      }

      return { files };
    },
  };
}
