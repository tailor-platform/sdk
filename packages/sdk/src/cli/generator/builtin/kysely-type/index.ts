import {
  type TailorDBGenerator,
  type TailorDBInput,
  type AggregateArgs,
  type GeneratorResult,
} from "@/cli/generator/types";
import { processKyselyType, generateUnifiedKyselyTypes } from "./type-processor";
import { type KyselyTypeMetadata, type KyselyNamespaceMetadata } from "./types";
import type { NormalizedTailorDBType } from "@/parser/service/tailordb/types";

export const KyselyGeneratorID = "@tailor-platform/kysely-type";

type KyselyGeneratorOptions = {
  distPath: string;
};

/**
 * Create a Kysely type generator for TailorDB types.
 * @param options - Generator options
 * @param options.distPath - Output file path
 * @returns TailorDB generator instance
 */
export function createKyselyGenerator(options: KyselyGeneratorOptions) {
  return {
    id: KyselyGeneratorID,
    description: "Generates Kysely type definitions for TailorDB types",
    dependencies: ["tailordb"] as const,

    async processType(args: {
      type: NormalizedTailorDBType;
      namespace: string;
    }): Promise<KyselyTypeMetadata> {
      return await processKyselyType(args.type);
    },

    async processTailorDBNamespace(args: {
      namespace: string;
      types: Record<string, KyselyTypeMetadata>;
    }): Promise<KyselyNamespaceMetadata> {
      const typesList = Object.values(args.types);

      const usedUtilityTypes = typesList.reduce(
        (acc, type) => ({
          Timestamp: acc.Timestamp || type.usedUtilityTypes.Timestamp,
          Serial: acc.Serial || type.usedUtilityTypes.Serial,
        }),
        { Timestamp: false, Serial: false },
      );

      return {
        namespace: args.namespace,
        types: typesList,
        usedUtilityTypes,
      };
    },

    aggregate(args: AggregateArgs<TailorDBInput<KyselyNamespaceMetadata>>): GeneratorResult {
      const files: GeneratorResult["files"] = [];

      const allNamespaceData: KyselyNamespaceMetadata[] = [];

      for (const nsResult of args.input.tailordb) {
        if (nsResult.types && nsResult.types.types.length > 0) {
          allNamespaceData.push(nsResult.types);
        }
      }

      if (allNamespaceData.length > 0) {
        const content = generateUnifiedKyselyTypes(allNamespaceData);
        files.push({
          path: options.distPath,
          content,
        });
      }

      return { files };
    },
  } satisfies TailorDBGenerator<KyselyTypeMetadata, KyselyNamespaceMetadata>;
}
