import {
  type CodeGenerator,
  type GeneratorResult,
  type GeneratorInput,
} from "@/cli/generator/types";
import { type Executor } from "@/configure/services/executor/types";
import { TypeProcessor } from "./type-processor";
import { type DbTypeMetadata } from "./types";
import type { ParsedTailorDBType } from "@/parser/service/tailordb/types";

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
      distPath: string | ((context: { tailorDB: string }) => string);
    },
  ) {}

  async processType(args: {
    type: ParsedTailorDBType;
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
            path:
              typeof this.options.distPath === "string"
                ? this.options.distPath
                : this.options.distPath({ tailorDB: nsResult.namespace }),
            content: nsResult.types,
          });
        }
      }
    }

    return { files };
  }
}
