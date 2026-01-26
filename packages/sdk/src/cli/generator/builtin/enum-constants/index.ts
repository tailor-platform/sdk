import {
  type TailorDBGenerator,
  type TailorDBInput,
  type AggregateArgs,
  type GeneratorResult,
} from "@/cli/generator/types";
import { generateUnifiedEnumConstants } from "./generate-enum-constants";
import { processEnumType } from "./process-enum-type";
import {
  type EnumConstantMetadata,
  type EnumDefinition,
  type EnumNamespaceMetadata,
} from "./types";
import type { ParsedTailorDBType } from "@/parser/service/tailordb/types";

export const EnumConstantsGeneratorID = "@tailor-platform/enum-constants";

type EnumConstantsGeneratorOptions = {
  distPath: string;
};

/**
 * Create an enum constants generator from TailorDB type definitions.
 * @param options - Generator options
 * @param options.distPath - Output file path
 * @returns TailorDB generator instance
 */
export function createEnumConstantsGenerator(options: EnumConstantsGeneratorOptions) {
  return {
    id: EnumConstantsGeneratorID,
    description: "Generates enum constants from TailorDB type definitions",
    dependencies: ["tailordb"] as const,

    async processType(args: {
      type: ParsedTailorDBType;
      namespace: string;
    }): Promise<EnumConstantMetadata> {
      return await processEnumType(args.type);
    },

    async processTailorDBNamespace(args: {
      namespace: string;
      types: Record<string, EnumConstantMetadata>;
    }): Promise<EnumNamespaceMetadata> {
      const allEnums: EnumDefinition[] = [];
      for (const enumConstantMetadata of Object.values(args.types)) {
        allEnums.push(...enumConstantMetadata.enums);
      }

      return {
        namespace: args.namespace,
        enums: allEnums,
      };
    },

    aggregate(args: AggregateArgs<TailorDBInput<EnumNamespaceMetadata>>): GeneratorResult {
      const files: GeneratorResult["files"] = [];

      const allEnums: EnumDefinition[] = [];

      for (const nsResult of args.input.tailordb) {
        if (nsResult.types && nsResult.types.enums.length > 0) {
          allEnums.push(...nsResult.types.enums);
        }
      }

      if (allEnums.length > 0) {
        const content = generateUnifiedEnumConstants(allEnums);
        files.push({
          path: options.distPath,
          content,
        });
      }

      return { files };
    },
  } satisfies TailorDBGenerator<EnumConstantMetadata, EnumNamespaceMetadata>;
}
