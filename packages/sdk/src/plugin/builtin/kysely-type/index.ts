import { resolve } from "pathe";
import { generatePGliteSchemaModule } from "./pglite-schema";
import { processKyselyType, generateUnifiedKyselyTypes } from "./type-processor";
import type { Plugin, GeneratorResult, TailorDBReadyContext } from "#/plugin/types";
import type { KyselyTypeMetadata, KyselyNamespaceMetadata } from "./types";

/** Unique identifier for the Kysely type generator plugin. */
export const KyselyGeneratorID = "@tailor-platform/kysely-type";

type KyselyTypePluginOptions = (
  | {
      /** Output file path for generated types. */
      distPath: string;
      contentMapper?: never;
    }
  | {
      /**
       * When `true`, no types file is generated. Import `getDB` from
       * `@tailor-platform/sdk/plugin/kysely-type/db` and let TypeScript derive its types through the content mapper.
       */
      contentMapper: true;
      distPath?: never;
    }
) & {
  pgliteSchemaPath?: string;
  /**
   * When `true`, generated tables map date/datetime fields and top-level time fields to
   * `Temporal.PlainDate`/`Temporal.Instant`/`Temporal.PlainTime` columns instead of
   * their `Date`/`string` defaults, and the generated `getDB` reads them back as those
   * Temporal values. Nested time fields remain strings. Defaults to `false`.
   */
  temporal?: boolean;
};

// Register this plugin's config type under its own id, via the package's
// real public specifier, so callers can resolve it type-safely from a
// `Plugin[]` array (see plugin/get-plugin-config.ts's resolvePluginConfig)
// without importing KyselyTypePluginOptions, which stays unexported.
declare module "@tailor-platform/sdk/plugin" {
  interface PluginConfigRegistry {
    "@tailor-platform/kysely-type": KyselyTypePluginOptions;
  }
}

/**
 * Conventional output path `kyselyTypePlugin` once assumed when `distPath` was not configured; the SDK no longer uses it.
 * @deprecated since NEXT_RELEASE — set `contentMapper: true` in place of `distPath` and import `getDB` from `@tailor-platform/sdk/plugin/kysely-type/db`. codemod: none (callers can only stop using it)
 */
export const DEFAULT_KYSELY_TYPES_DIST_PATH = "./generated/tailordb.ts";

/**
 * Plugin that generates Kysely type definitions for TailorDB tables.
 * @param options - Plugin options
 * @param options.distPath - Output file path for generated types; set either this or `contentMapper`, not both
 * @param options.contentMapper - When `true`, no types file is generated and you import `getDB` from `@tailor-platform/sdk/plugin/kysely-type/db` instead; set either this or `distPath`, not both
 * @param options.pgliteSchemaPath - Output file path for the PGlite `CREATE TABLE` script module; omit to skip it
 * @param options.temporal - When `true`, generated tables map date/datetime fields and
 * top-level time fields to their `Temporal.PlainDate`/`Temporal.Instant`/
 * `Temporal.PlainTime` counterparts instead of `Date`/`string`. Nested time fields
 * remain strings. Defaults to `false`.
 * @returns Plugin instance with onTailorDBReady hook
 */
export function kyselyTypePlugin(
  options: KyselyTypePluginOptions,
): Plugin<unknown, KyselyTypePluginOptions> {
  const { distPath, contentMapper } = options as { distPath?: string; contentMapper?: boolean };
  if (distPath !== undefined && contentMapper !== undefined) {
    throw new Error("kyselyTypePlugin accepts either distPath or contentMapper: true, not both.");
  }
  if (distPath === undefined && contentMapper !== true) {
    throw new Error("kyselyTypePlugin requires either distPath or contentMapper: true.");
  }
  return {
    id: KyselyGeneratorID,
    description: "Generates Kysely type definitions for TailorDB tables",
    pluginConfig: options,

    async onTailorDBReady(
      ctx: TailorDBReadyContext<KyselyTypePluginOptions>,
    ): Promise<GeneratorResult> {
      const { distPath, pgliteSchemaPath, temporal } = ctx.pluginConfig;
      if (distPath && pgliteSchemaPath && resolve(distPath) === resolve(pgliteSchemaPath)) {
        throw new Error("distPath and pgliteSchemaPath must resolve to different files.");
      }

      const allNamespaceData: KyselyNamespaceMetadata[] = [];

      for (const ns of ctx.tailordb) {
        const typeMetadataList: KyselyTypeMetadata[] = [];

        for (const type of Object.values(ns.tables)) {
          const metadata = await processKyselyType(type, temporal);
          typeMetadataList.push(metadata);
        }

        if (typeMetadataList.length === 0) continue;

        allNamespaceData.push({
          namespace: ns.namespace,
          types: typeMetadataList,
        });
      }

      const files: GeneratorResult["files"] = [];
      if (allNamespaceData.length > 0) {
        if (distPath) {
          files.push({
            path: distPath,
            content: generateUnifiedKyselyTypes(allNamespaceData, temporal),
          });
        }
        if (ctx.pluginConfig.pgliteSchemaPath) {
          files.push({
            path: ctx.pluginConfig.pgliteSchemaPath,
            content: generatePGliteSchemaModule(
              ctx.tailordb.filter((ns) => Object.keys(ns.tables).length > 0),
            ),
          });
        }
      }

      return { files };
    },
  };
}
