import {
  type CodeGenerator,
  type GeneratorResult,
  type GeneratorInput,
} from "@/cli/generator/types";
import { EnumProcessor } from "./enum-processor";
import { type EnumConstantMetadata, type EnumDefinition } from "./types";
import type { ParsedTailorDBType } from "@/parser/service/tailordb/types";

export const EnumConstantsGeneratorID = "@tailor-platform/enum-constants";

/**
 * Generator for enum constants from TailorDB type definitions.
 */
export class EnumConstantsGenerator
  implements
    CodeGenerator<EnumConstantMetadata, undefined, undefined, string, undefined>
{
  readonly id = EnumConstantsGeneratorID;
  readonly description =
    "Generates enum constants from TailorDB type definitions";

  constructor(
    private readonly options: {
      distPath: string;
    },
  ) {}

  async processType(args: {
    type: ParsedTailorDBType;
    applicationNamespace: string;
    namespace: string;
  }): Promise<EnumConstantMetadata> {
    return await EnumProcessor.processType(args.type);
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
    types: Record<string, EnumConstantMetadata>;
  }): Promise<string> {
    const allEnums: EnumDefinition[] = [];
    for (const enumConstantMetadata of Object.values(args.types)) {
      allEnums.push(...enumConstantMetadata.enums);
    }

    if (allEnums.length === 0) {
      return "";
    }

    return JSON.stringify({
      namespace: args.namespace,
      enums: allEnums,
    });
  }

  processIdProvider(): undefined {
    return undefined;
  }

  processAuth(): undefined {
    return undefined;
  }

  processStaticWebsite(): undefined {
    return undefined;
  }

  aggregate(args: {
    inputs: GeneratorInput<string, undefined>[];
    executorInputs: undefined[];
    baseDir: string;
  }): GeneratorResult {
    const files: GeneratorResult["files"] = [];

    const allEnums: EnumDefinition[] = [];

    for (const input of args.inputs) {
      for (const nsResult of input.tailordb) {
        const parsed = JSON.parse(nsResult.types);
        if (parsed.namespace && parsed.enums) {
          allEnums.push(...parsed.enums);
        }
      }
    }

    console.log(JSON.stringify(allEnums, null, 2));

    if (allEnums.length === 0) {
      return { files };
    }

    // Generate content

    return { files };
  }
}
