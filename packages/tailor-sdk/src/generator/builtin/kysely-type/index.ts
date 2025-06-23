import { CodeGenerator, GeneratorResult } from "../../types";
import { TailorDBType } from "@/services/tailordb/schema";
import { measure } from "@/performance";
import { KyselyTypeMetadata } from "./types";
import { TypeProcessor } from "./type-processor";

export const KyselyGeneratorID = "@tailor/kysely-type";

/**
 * Kysely型生成システムのメインエントリーポイント
 */
export class KyselyGenerator
  implements CodeGenerator<KyselyTypeMetadata, undefined, string>
{
  readonly id = KyselyGeneratorID;
  readonly description = "Generates Kysely type definitions for TailorDB types";

  constructor(private readonly options: { distPath: string }) {}

  @measure
  async processType(type: TailorDBType): Promise<KyselyTypeMetadata> {
    return await TypeProcessor.processType(type);
  }

  async processTypes(
    types: Record<string, KyselyTypeMetadata>,
  ): Promise<string> {
    return await TypeProcessor.processTypes(types);
  }

  @measure
  processResolver(): undefined {}

  @measure
  aggregate({ types }: { types: string }): GeneratorResult {
    return {
      files: [
        {
          path: this.options.distPath,
          content: types,
        },
      ],
    };
  }
}
