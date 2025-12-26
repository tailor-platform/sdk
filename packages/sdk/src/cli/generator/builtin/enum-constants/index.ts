import {
  type TailorDBGenerator,
  type TailorDBInput,
  type AggregateArgs,
  type GeneratorResult,
} from "@/cli/generator/types";
import { EnumProcessor } from "./enum-processor";
import {
  type EnumConstantMetadata,
  type EnumDefinition,
  type EnumNamespaceMetadata,
} from "./types";
import type { ParsedTailorDBType } from "@/parser/service/tailordb/types";

export const EnumConstantsGeneratorID = "@tailor-platform/enum-constants";

/**
 * Generator for enum constants from TailorDB type definitions.
 */
export class EnumConstantsGenerator implements TailorDBGenerator<
  EnumConstantMetadata,
  EnumNamespaceMetadata
> {
  readonly id = EnumConstantsGeneratorID;
  readonly description = "Generates enum constants from TailorDB type definitions";
  readonly dependencies = ["tailordb"] as const;

  constructor(
    private readonly options: {
      distPath: string;
    },
  ) {}

  async processType(args: {
    type: ParsedTailorDBType;
    namespace: string;
  }): Promise<EnumConstantMetadata> {
    return await EnumProcessor.processType(args.type);
  }

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
  }

  aggregate(args: AggregateArgs<TailorDBInput<EnumNamespaceMetadata>>): GeneratorResult {
    const files: GeneratorResult["files"] = [];

    const allEnums: EnumDefinition[] = [];

    for (const nsResult of args.input.tailordb) {
      if (nsResult.types && nsResult.types.enums.length > 0) {
        allEnums.push(...nsResult.types.enums);
      }
    }

    if (allEnums.length > 0) {
      const content = EnumProcessor.generateUnifiedEnumConstants(allEnums);
      files.push({
        path: this.options.distPath,
        content,
      });
    }

    return { files };
  }
}
