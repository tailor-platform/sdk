import { processKyselyType, generateUnifiedKyselyTypes } from "./type-processor";
import type { KyselyTypeMetadata, KyselyNamespaceMetadata } from "./types";
import type { Plugin } from "@/types/plugin";
import type { GeneratorResult, TailorDBReadyContext } from "@/types/plugin-generation";

/** Unique identifier for the Kysely type generator plugin. */
export const KyselyGeneratorID = "@tailor-platform/kysely-type";

type KyselyTypePluginOptions = {
  distPath: string;
};

/**
 * Plugin that generates Kysely type definitions for TailorDB types.
 * @param options - Plugin options
 * @param options.distPath - Output file path for generated types
 * @returns Plugin instance with onTailorDBReady hook
 */
export function kyselyTypePlugin(
  options: KyselyTypePluginOptions,
): Plugin<unknown, KyselyTypePluginOptions> {
  return {
    id: KyselyGeneratorID,
    description: "Generates Kysely type definitions for TailorDB types",
    pluginConfig: options,

    async onTailorDBReady(
      ctx: TailorDBReadyContext<KyselyTypePluginOptions>,
    ): Promise<GeneratorResult> {
      const allNamespaceData: KyselyNamespaceMetadata[] = [];

      for (const ns of ctx.tailordb) {
        const typeMetadataList: KyselyTypeMetadata[] = [];

        for (const type of Object.values(ns.types)) {
          const metadata = await processKyselyType(type);
          typeMetadataList.push(metadata);
        }

        if (typeMetadataList.length === 0) continue;

        const usedUtilityTypes = typeMetadataList.reduce(
          (acc, type) => ({
            Timestamp: acc.Timestamp || type.usedUtilityTypes.Timestamp,
            Serial: acc.Serial || type.usedUtilityTypes.Serial,
          }),
          { Timestamp: false, Serial: false },
        );

        allNamespaceData.push({
          namespace: ns.namespace,
          types: typeMetadataList,
          usedUtilityTypes,
        });
      }

      const files: GeneratorResult["files"] = [];
      if (allNamespaceData.length > 0) {
        const content = generateUnifiedKyselyTypes(allNamespaceData);
        files.push({
          path: ctx.pluginConfig.distPath,
          content,
        });
      }

      return { files };
    },
  };
}
