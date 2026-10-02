import { dirname, resolve } from "pathe";
import { generatePGliteSchemaModule } from "./pglite-schema";
import { processKyselyType, generateUnifiedKyselyTypes } from "./type-processor";
import type {
  Plugin,
  GeneratorResult,
  TailorDBNamespaceData,
  TailorDBReadyContext,
} from "#/plugin/types";
import type { KyselyTypeMetadata, KyselyNamespaceMetadata } from "./types";

/** Unique identifier for the Kysely type generator plugin. */
export const KyselyGeneratorID = "@tailor-platform/kysely-type";

type KyselyAdditionalNamespaces = {
  /** Path to the tailor.config.ts that defines the namespaces, relative to this config's directory. */
  configPath: string;
  /** Namespace names in that config's `db`. Omit to include every namespace there without `external: true`. */
  namespaces?: string[];
};

type KyselyTypePluginOptions = {
  distPath: string;
  pgliteSchemaPath?: string;
  additionalNamespaces?: KyselyAdditionalNamespaces[];
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

/** Conventional output path used when `kyselyTypePlugin` has no `distPath` configured. */
export const DEFAULT_KYSELY_TYPES_DIST_PATH = "./generated/tailordb.ts";

/**
 * Reject an `additionalNamespaces` value whose shape the types do not guarantee at runtime.
 * @param value - Configured `additionalNamespaces`
 */
function assertAdditionalNamespaces(
  value: unknown,
): asserts value is KyselyAdditionalNamespaces[] | undefined {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    throw new Error("additionalNamespaces must be an array.");
  }
  Array.from(value).forEach((entry: unknown, index) => {
    const label = `additionalNamespaces[${index}]`;
    if (typeof entry !== "object" || entry === null) {
      throw new Error(`${label} must be an object.`);
    }
    const { configPath, namespaces } = entry as Record<string, unknown>;
    if (typeof configPath !== "string" || configPath === "") {
      throw new Error(`${label}.configPath must be a non-empty string.`);
    }
    if (
      namespaces !== undefined &&
      (!Array.isArray(namespaces) ||
        namespaces.length === 0 ||
        !Array.from(namespaces).every(
          (namespace) => typeof namespace === "string" && namespace !== "",
        ))
    ) {
      throw new Error(`${label}.namespaces must be a non-empty array of non-empty strings.`);
    }
  });
}

/**
 * Reject additional namespaces that collide with this config's namespaces or with each other.
 * @param ownNamespaces - Namespaces of this config
 * @param additionalNamespaces - Namespaces taken from other configs
 */
function assertNoNamespaceConflicts(
  ownNamespaces: readonly string[],
  additionalNamespaces: readonly string[],
): void {
  const own = new Set(ownNamespaces);
  const seen = new Set<string>();
  for (const namespace of additionalNamespaces) {
    if (own.has(namespace)) {
      throw new Error(
        `additionalNamespaces: namespace "${namespace}" is already defined in this config's db.`,
      );
    }
    if (seen.has(namespace)) {
      throw new Error(`additionalNamespaces: namespace "${namespace}" is included more than once.`);
    }
    seen.add(namespace);
  }
}

/**
 * Load the namespaces listed in `additionalNamespaces` from their own configs.
 * @param ctx - onTailorDBReady context
 * @returns Loaded namespaces in listed order
 */
async function loadAdditionalNamespaces(
  ctx: TailorDBReadyContext<KyselyTypePluginOptions>,
): Promise<TailorDBNamespaceData[]> {
  const configured: unknown = ctx.pluginConfig.additionalNamespaces;
  assertAdditionalNamespaces(configured);
  const additionalNamespaces = configured ?? [];
  const ownNamespaces = ctx.tailordb.map((ns) => ns.namespace);
  assertNoNamespaceConflicts(
    ownNamespaces,
    additionalNamespaces.flatMap((entry) => entry.namespaces ?? []),
  );

  const loaded: TailorDBNamespaceData[] = [];
  for (const [index, { configPath, namespaces }] of additionalNamespaces.entries()) {
    const resolvedConfigPath = resolve(dirname(ctx.configPath), configPath);
    try {
      loaded.push(...(await ctx.loadTailorDB(resolvedConfigPath, namespaces)));
    } catch (error) {
      throw new Error(
        `additionalNamespaces[${index}]: failed to load from ${resolvedConfigPath}: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  }
  assertNoNamespaceConflicts(
    ownNamespaces,
    loaded.map((ns) => ns.namespace),
  );
  return loaded;
}

/**
 * Plugin that generates Kysely type definitions for TailorDB tables.
 * @param options - Plugin options
 * @param options.distPath - Output file path for generated types
 * @param options.pgliteSchemaPath - Output file path for the PGlite `CREATE TABLE` script module; omit to skip it
 * @param options.additionalNamespaces - Namespaces owned by other tailor.config.ts files to also make selectable with `getDB()`
 * @returns Plugin instance with onTailorDBReady hook
 */
export function kyselyTypePlugin(
  options: KyselyTypePluginOptions,
): Plugin<unknown, KyselyTypePluginOptions> {
  return {
    id: KyselyGeneratorID,
    description: "Generates Kysely type definitions for TailorDB tables",
    pluginConfig: options,

    async onTailorDBReady(
      ctx: TailorDBReadyContext<KyselyTypePluginOptions>,
    ): Promise<GeneratorResult> {
      const { distPath, pgliteSchemaPath } = ctx.pluginConfig;
      if (pgliteSchemaPath && resolve(distPath) === resolve(pgliteSchemaPath)) {
        throw new Error("distPath and pgliteSchemaPath must resolve to different files.");
      }

      const additionalTailorDB = await loadAdditionalNamespaces(ctx);
      const tailordb = [...ctx.tailordb, ...additionalTailorDB];
      const allNamespaceData: KyselyNamespaceMetadata[] = [];

      for (const ns of tailordb) {
        const typeMetadataList: KyselyTypeMetadata[] = [];

        for (const type of Object.values(ns.tables)) {
          const metadata = await processKyselyType(type);
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
        const content = generateUnifiedKyselyTypes(allNamespaceData);
        files.push({
          path: ctx.pluginConfig.distPath,
          content,
        });
        if (ctx.pluginConfig.pgliteSchemaPath) {
          files.push({
            path: ctx.pluginConfig.pgliteSchemaPath,
            content: generatePGliteSchemaModule(
              tailordb.filter((ns) => Object.keys(ns.tables).length > 0),
            ),
          });
        }
      }

      return { files };
    },
  };
}
