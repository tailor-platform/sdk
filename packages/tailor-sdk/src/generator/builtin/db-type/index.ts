import { CodeGenerator, GeneratorResult, GeneratorInput } from "../../types";
import { TailorDBType } from "@/services/tailordb/schema";
import { measure } from "@/performance";
import { DbTypeMetadata } from "./types";
import { TypeProcessor } from "./type-processor";

export const DbTypeGeneratorID = "@tailor/db-type";

/**
 * TypeScript型定義生成システムのメインエントリーポイント
 */
export class DbTypeGenerator
  implements CodeGenerator<DbTypeMetadata, undefined, string, undefined>
{
  readonly id = DbTypeGeneratorID;
  readonly description =
    "Generates TypeScript type definitions for TailorDB types with cross-references";

  constructor(
    private readonly options: {
      distPath: (context: { app: string; tailorDB: string }) => string;
    },
  ) {}

  @measure
  async processType(type: TailorDBType): Promise<DbTypeMetadata> {
    return await TypeProcessor.processType(type);
  }

  @measure
  processResolver(): undefined {
    return undefined;
  }

  async processTailorDBNamespace(
    _applicationNamespace: string,
    _namespace: string,
    types: Record<string, DbTypeMetadata>,
  ): Promise<string> {
    return await TypeProcessor.processTypes(types);
  }

  @measure
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
