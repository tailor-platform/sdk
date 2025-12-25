import {
  type TailorDBGenerator,
  type TailorDBInput,
  type AggregateArgs,
  type GeneratorResult,
} from "@/cli/generator/types";
import { FileProcessor } from "./file-processor";
import { type FileUtilMetadata } from "./types";
import type { ParsedTailorDBType } from "@/parser/service/tailordb/types";

export const FileUtilsGeneratorID = "@tailor-platform/file-utils";

/**
 * Generator for file utility functions from TailorDB type definitions.
 */
export class FileUtilsGenerator implements TailorDBGenerator<
  FileUtilMetadata,
  string
> {
  readonly id = FileUtilsGeneratorID;
  readonly description =
    "Generates TypeWithFiles interface from TailorDB type definitions";
  readonly dependencies = ["tailordb"] as const;

  constructor(
    private readonly options: {
      distPath: string;
    },
  ) {}

  async processType(args: {
    type: ParsedTailorDBType;
    namespace: string;
  }): Promise<FileUtilMetadata> {
    return await FileProcessor.processType(args.type);
  }

  async processTailorDBNamespace(args: {
    namespace: string;
    types: Record<string, FileUtilMetadata>;
  }): Promise<string> {
    // Return empty string for now - actual generation happens in aggregate
    const typesWithFiles = Object.values(args.types).filter(
      (t) => t.fileFields.length > 0,
    );
    if (typesWithFiles.length === 0) {
      return "";
    }
    // Store namespace info as JSON to be parsed in aggregate
    return JSON.stringify({
      namespace: args.namespace,
      types: typesWithFiles,
    });
  }

  aggregate(args: AggregateArgs<TailorDBInput<string>>): GeneratorResult {
    const files: GeneratorResult["files"] = [];

    // Collect all namespace metadata
    const allNamespaceData: { namespace: string; types: FileUtilMetadata[] }[] =
      [];

    for (const nsResult of args.input.tailordb) {
      if (nsResult.types) {
        try {
          const parsed = JSON.parse(nsResult.types);
          if (parsed.namespace && parsed.types) {
            allNamespaceData.push(parsed);
          }
        } catch {
          // Ignore invalid JSON (should not happen)
        }
      }
    }

    // If there are any types with files, generate the unified output
    if (allNamespaceData.length > 0) {
      const content = FileProcessor.generateUnifiedFileUtils(allNamespaceData);
      if (content) {
        files.push({
          path: this.options.distPath,
          content,
        });
      }
    }

    return { files };
  }
}
