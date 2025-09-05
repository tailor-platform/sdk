import {
  type CodeGenerator,
  type GeneratorResult,
  type GeneratorInput,
} from "../../types";
import { type TailorDBType } from "@/services/tailordb/schema";
import { type Executor } from "@/services/executor/types";
import { type DbTypeMetadata } from "./types";
import { TypeProcessor } from "./type-processor";

export const DbTypeGeneratorID = "@tailor/db-type";

/**
 * TypeScript型定義生成システムのメインエントリーポイント
 */
export class DbTypeGenerator
  implements
    CodeGenerator<DbTypeMetadata, undefined, undefined, string, undefined>
{
  readonly id = DbTypeGeneratorID;
  readonly description =
    "Generates TypeScript type definitions for TailorDB types with cross-references";

  constructor(
    private readonly options: {
      distPath: (context: { app: string; tailorDB: string }) => string;
    },
  ) {}

  async processType(args: {
    type: TailorDBType;
    applicationNamespace: string;
    namespace: string;
  }): Promise<DbTypeMetadata> {
    return await TypeProcessor.processType(args.type);
  }

  processResolver(): undefined {
    return undefined;
  }

  processExecutor(_executor: Executor): undefined {
    return undefined;
  }

  async processTailorDBNamespace(args: {
    applicationNamespace: string;
    namespace: string;
    types: Record<string, DbTypeMetadata>;
  }): Promise<string> {
    return await TypeProcessor.processTypes(args.types);
  }

  aggregate(args: {
    inputs: GeneratorInput<string, undefined>[];
    executorInputs: undefined[];
    baseDir: string;
  }): GeneratorResult {
    const files: GeneratorResult["files"] = [];

    for (const input of args.inputs) {
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
