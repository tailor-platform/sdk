import * as path from "pathe";
import { assertDefined } from "#/utils/assert";
import { PluginValidationError } from "#/utils/plugin-validation-error";
import {
  namesSharedAcrossNamespaces,
  qualifiedTailorDBTypeName,
} from "#/utils/tailordb-type-names";
import {
  processIdpUser,
  generateIdpUserSchemaFile,
  type IdpUserMetadata,
} from "./idp-user-processor";
import {
  processLinesDb,
  generateLinesDbSchemaFile,
  generateLinesDbSchemaFileWithPluginAPI,
  type PluginSchemaParams,
} from "./lines-db-processor";
import type {
  GeneratorAuthInput,
  GeneratorResult,
  Plugin,
  TailorDBReadyContext,
} from "#/plugin/types";

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
  /** Machine user the seed runs as, by name or with its Auth service as `{ namespace, machineUserName }`. */
  machineUserName?: string | { namespace: string; machineUserName: string };
  /**
   * Disable individual `_User <-> userProfile` foreign keys emitted into
   * the generated seed schema. Both directions are emitted by default.
   *
   * Set a direction to `true` to relax it — for example to seed invited
   * users that do not yet have an IdP credential.
   */
  disableIdpUserSync?: DisableIdpUserSyncDirections;
  /**
   * Named combinations of datasets, so `tailor seed apply --dataset preview`
   * stands for every dataset directory the name lists. A dataset directory is
   * a directory under `<distPath>/data/` holding JSONL files for some of the
   * tables; its rows are applied on top of the rows in `<distPath>/data/`.
   * @example { preview: ["cogs", "shipments"], dev: ["local"] }
   */
  datasets?: Record<string, readonly string[]>;
};

declare module "@tailor-platform/sdk/plugin" {
  interface PluginConfigRegistry {
    "@tailor-platform/seed": SeedPluginOptions;
  }
}

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
 * Find the one Auth service whose built-in IdP users the seed holds.
 * @param auths - Auth services by name
 * @returns The IdP user metadata of that Auth service, or null when none has a built-in IdP with a userProfile
 */
export function soleIdpUser(
  auths: Readonly<Record<string, GeneratorAuthInput>>,
): IdpUserMetadata | null {
  const idpUsers = Object.entries(auths).flatMap(([name, auth]) => {
    const idpUser = processIdpUser(auth);
    return idpUser ? [{ name, idpUser }] : [];
  });
  if (idpUsers.length > 1) {
    const names = idpUsers.map(({ name }) => name);
    throw new PluginValidationError({
      code: "SEED_IDP_USER_AUTH_AMBIGUOUS",
      message: `seedPlugin seeds the users of one built-in IdP, but these Auth services each use one: ${names.join(", ")}.`,
      suggestion: "Keep one Auth service with a built-in IdP and a userProfile in the config.",
      context: { pluginId: SeedGeneratorID, auths: names },
    });
  }
  return idpUsers[0]?.idpUser ?? null;
}

/**
 * Plugin that generates seed data and schema files consumed by the
 * `tailor seed` commands (@tailor-platform/sdk-plugin-seed).
 * @param options - Plugin options
 * @param options.distPath - Output directory path for generated seed files
 * @param options.machineUserName - Default machine user name for authentication
 * @param options.disableIdpUserSync - Skip emitting individual `_User <-> userProfile` foreign keys. Both directions are emitted by default; set a direction to `true` to relax that side.
 * @param options.datasets - Named combinations of dataset directories under `<distPath>/data/`, selected with `tailor seed apply --dataset <name>`.
 * @returns Plugin instance with onTailorDBReady hook
 */
export function seedPlugin(options: SeedPluginOptions): Plugin<unknown, SeedPluginOptions> {
  return {
    id: SeedGeneratorID,
    description: "Generates seed data and schema files for the tailor seed CLI plugin",
    pluginConfig: options,

    async onTailorDBReady(ctx: TailorDBReadyContext<SeedPluginOptions>): Promise<GeneratorResult> {
      const files: GeneratorResult["files"] = [];
      const outputDir = path.resolve(path.dirname(ctx.configPath), ctx.pluginConfig.distPath);

      // Process IdP user early so we can add reverse FK to the user profile type
      const idpUser = soleIdpUser(ctx.auths);
      const idpUserSyncFKs = resolveIdpUserSyncFKs(ctx.pluginConfig.disableIdpUserSync);

      const sharedTypeNames = namesSharedAcrossNamespaces(
        ctx.tailordb.map((ns) => Object.keys(ns.tables)),
      );

      for (const ns of ctx.tailordb) {
        const fileStemOf = (typeName: string) =>
          qualifiedTailorDBTypeName(ns.namespace, typeName, sharedTypeNames);
        for (const [tableName, type] of Object.entries(ns.tables)) {
          const source = assertDefined(
            ns.sourceInfo.get(tableName),
            `source info missing for table: ${tableName}`,
          );
          const linesDb = processLinesDb(type, source);
          linesDb.foreignKeys = linesDb.foreignKeys.map((foreignKey) => ({
            ...foreignKey,
            references: {
              ...foreignKey.references,
              table: fileStemOf(foreignKey.references.table),
            },
          }));
          const fileStem = fileStemOf(tableName);

          // Add reverse FK from userProfile table to _User (opt-out via disableIdpUserSync.userToIdp: true)
          if (
            idpUserSyncFKs.emitUserToIdpFK &&
            idpUser &&
            tableName === idpUser.schema.userTableName &&
            (idpUser.schema.userTableNamespace === undefined ||
              idpUser.schema.userTableNamespace === ns.namespace)
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
            path: path.join(outputDir, "data", `${fileStem}.jsonl`),
            content: "",
            skipIfExists: true,
          });

          const schemaOutputPath = path.join(outputDir, "data", `${fileStem}.schema.ts`);

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
              namespace: ns.namespace,
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
            // A table with plugins attached may carry fields the source file does not
            // declare, so its schema loads the table through the config.
            const hasPlugins = (ns.pluginAttachments.get(tableName)?.length ?? 0) > 0;
            const configImportPath = hasPlugins
              ? path.relative(path.dirname(schemaOutputPath), ctx.configPath)
              : undefined;
            const schemaContent = generateLinesDbSchemaFile(linesDb, {
              typeImportPath,
              configImportPath,
            });

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
          path: path.join(outputDir, idpUser.dataFile),
          content: "",
          skipIfExists: true,
        });

        // Generate schema file with foreign key (opt-out via disableIdpUserSync.idpToUser: true)
        files.push({
          path: path.join(outputDir, "data", `${idpUser.name}.schema.ts`),
          content: generateIdpUserSchemaFile({
            usernameField: idpUser.schema.usernameField,
            userTableName:
              idpUser.schema.userTableNamespace === undefined
                ? idpUser.schema.userTableName
                : qualifiedTailorDBTypeName(
                    idpUser.schema.userTableNamespace,
                    idpUser.schema.userTableName,
                    sharedTypeNames,
                  ),
            includeUserProfileFK: idpUserSyncFKs.emitIdpToUserFK,
          }),
        });
      }

      return { files };
    },
  };
}
