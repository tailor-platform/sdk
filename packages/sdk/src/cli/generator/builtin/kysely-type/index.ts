import {
  type CodeGenerator,
  type GeneratorResult,
  type GeneratorInput,
} from "@/cli/generator/types";
import { TypeProcessor } from "./type-processor";
import { type KyselyTypeMetadata } from "./types";
import type { ParsedTailorDBType } from "@/parser/service/tailordb/types";

export const KyselyGeneratorID = "@tailor-platform/kysely-type";

/**
 * Main entry point for the Kysely type generation system.
 */
export class KyselyGenerator
  implements
    CodeGenerator<KyselyTypeMetadata, undefined, undefined, string, undefined>
{
  readonly id = KyselyGeneratorID;
  readonly description = "Generates Kysely type definitions for TailorDB types";

  constructor(
    private readonly options: {
      distPath: string;
    },
  ) {}

  async processType(args: {
    type: ParsedTailorDBType;
    applicationNamespace: string;
    namespace: string;
  }): Promise<KyselyTypeMetadata> {
    return await TypeProcessor.processType(args.type);
  }

  processResolver(): undefined {
    return undefined;
  }

  processExecutor(): undefined {
    return undefined;
  }

  async processTailorDBNamespace(args: {
    applicationNamespace: string;
    namespace: string;
    types: Record<string, KyselyTypeMetadata>;
  }): Promise<string> {
    const typesList = Object.values(args.types);
    if (typesList.length === 0) {
      return "";
    }

    const usedUtilityTypes = typesList.reduce(
      (acc, type) => ({
        Timestamp: acc.Timestamp || type.usedUtilityTypes.Timestamp,
        Serial: acc.Serial || type.usedUtilityTypes.Serial,
      }),
      { Timestamp: false, Serial: false },
    );

    return JSON.stringify({
      namespace: args.namespace,
      types: typesList,
      usedUtilityTypes,
    });
  }

  aggregate(args: {
    inputs: GeneratorInput<string, undefined>[];
    executorInputs: undefined[];
    baseDir: string;
  }): GeneratorResult {
    const files: GeneratorResult["files"] = [];

    const allNamespaceData: {
      namespace: string;
      types: KyselyTypeMetadata[];
      usedUtilityTypes: { Timestamp: boolean; Serial: boolean };
    }[] = [];

    for (const input of args.inputs) {
      for (const nsResult of input.tailordb) {
        if (nsResult.types) {
          const parsed = JSON.parse(nsResult.types);
          if (parsed.namespace && parsed.types) {
            allNamespaceData.push(parsed);
          }
        }
      }
    }

    if (allNamespaceData.length === 0) {
      return { files };
    }

    const content = TypeProcessor.generateUnifiedTypes(allNamespaceData);
    if (content) {
      files.push({
        path: this.options.distPath,
        content,
      });
    }

    return { files };
  }
}
