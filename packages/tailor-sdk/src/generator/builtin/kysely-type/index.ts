import {
  type CodeGenerator,
  type GeneratorResult,
  type GeneratorInput,
} from "../../types";
import { type TailorDBType } from "@/services/tailordb/schema";
import { type Executor } from "@/services/executor/types";
import { type KyselyTypeMetadata } from "./types";
import { TypeProcessor } from "./type-processor";

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
      distPath: string | ((context: { tailorDB: string }) => string);
    },
  ) {}

  async processType(args: {
    type: TailorDBType;
    applicationNamespace: string;
    namespace: string;
  }): Promise<KyselyTypeMetadata> {
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
    types: Record<string, KyselyTypeMetadata>;
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
