import {
  type TailorDBGenerator,
  type TailorDBInput,
  type AggregateArgs,
  type GeneratorResult,
} from "@/cli/generator/types";
import { TypeProcessor } from "./type-processor";
import { type KyselyTypeMetadata, type KyselyNamespaceMetadata } from "./types";
import type { ParsedTailorDBType } from "@/parser/service/tailordb/types";

export const KyselyGeneratorID = "@tailor-platform/kysely-type";

/**
 * Main entry point for the Kysely type generation system.
 */
export class KyselyGenerator implements TailorDBGenerator<
  KyselyTypeMetadata,
  KyselyNamespaceMetadata
> {
  readonly id = KyselyGeneratorID;
  readonly description = "Generates Kysely type definitions for TailorDB types";
  readonly dependencies = ["tailordb"] as const;

  constructor(
    private readonly options: {
      distPath: string;
    },
  ) {}

  async processType(args: {
    type: ParsedTailorDBType;
    namespace: string;
  }): Promise<KyselyTypeMetadata> {
    return await TypeProcessor.processType(args.type);
  }

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
  }

  aggregate(args: AggregateArgs<TailorDBInput<KyselyNamespaceMetadata>>): GeneratorResult {
    const files: GeneratorResult["files"] = [];

    const allNamespaceData: KyselyNamespaceMetadata[] = [];

    for (const nsResult of args.input.tailordb) {
      if (nsResult.types && nsResult.types.types.length > 0) {
        allNamespaceData.push(nsResult.types);
      }
    }

    if (allNamespaceData.length > 0) {
      const content = TypeProcessor.generateUnifiedTypes(allNamespaceData);
      files.push({
        path: this.options.distPath,
        content,
      });
    }

    return { files };
  }
}
