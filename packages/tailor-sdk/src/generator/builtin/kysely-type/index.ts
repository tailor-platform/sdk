import { CodeGenerator, GeneratorResult, GeneratorInput } from "../../types";
import { TailorDBType } from "@/services/tailordb/schema";
import { Executor } from "@/services/executor/types";
import { KyselyTypeMetadata } from "./types";
import { TypeProcessor } from "./type-processor";

export const KyselyGeneratorID = "@tailor/kysely-type";

/**
 * Kysely型生成システムのメインエントリーポイント
 */
export class KyselyGenerator
  implements
    CodeGenerator<KyselyTypeMetadata, undefined, undefined, string, undefined>
{
  readonly id = KyselyGeneratorID;
  readonly description = "Generates Kysely type definitions for TailorDB types";

  constructor(
    private readonly options: {
      distPath: (context: { app: string; tailorDB: string }) => string;
    },
  ) {}

  async processType(type: TailorDBType): Promise<KyselyTypeMetadata> {
    return await TypeProcessor.processType(type);
  }

  processResolver(): undefined {
    return undefined;
  }

  processExecutor(_executor: Executor): undefined {
    return undefined;
  }

  async processTailorDBNamespace(
    _applicationNamespace: string,
    _namespace: string,
    types: Record<string, KyselyTypeMetadata>,
  ): Promise<string> {
    return await TypeProcessor.processTypes(types);
  }

  aggregate(inputs: GeneratorInput<string, undefined>[]): GeneratorResult {
    const files: GeneratorResult["files"] = [];

    for (const input of inputs) {
      for (const nsResult of input.tailordb) {
        if (nsResult.types) {
          files.push({
            path: this.options.distPath({
              app: input.applicationNamespace,
              tailorDB: nsResult.namespace,
            }),
            content: nsResult.types,
          });
        }
      }
    }

    return { files };
  }
}
