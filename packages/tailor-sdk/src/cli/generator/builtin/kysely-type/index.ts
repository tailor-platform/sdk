import {
  type CodeGenerator,
  type GeneratorResult,
  type GeneratorInput,
} from "@/cli/generator/types";
import { TypeProcessor } from "./type-processor";
import { type KyselyTypeMetadata } from "./types";
import type { ParsedTailorDBType } from "@/parser/service/tailordb/types";

export const KyselyGeneratorID = "@tailor/kysely-type";

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
    return await TypeProcessor.processTypes(args.types, args.namespace);
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
            path: this.options.distPath,
            content: nsResult.types,
          });
        }
      }
    }

    return { files };
  }
}
