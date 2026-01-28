import {
  type TailorDBGenerator,
  type TailorDBInput,
  type AggregateArgs,
  type GeneratorResult,
} from "@/cli/generator/types";
import { generateUnifiedFileUtils } from "./generate-file-utils";
import { processFileType } from "./process-file-type";
import { type FileUtilMetadata } from "./types";
import type { NormalizedTailorDBType } from "@/parser/service/tailordb/types";

export const FileUtilsGeneratorID = "@tailor-platform/file-utils";

type FileUtilsGeneratorOptions = {
  distPath: string;
};

/**
 * Create a file utilities generator from TailorDB type definitions.
 * @param options - Generator options
 * @param options.distPath - Output file path
 * @returns TailorDB generator instance
 */
export function createFileUtilsGenerator(options: FileUtilsGeneratorOptions) {
  return {
    id: FileUtilsGeneratorID,
    description: "Generates TypeWithFiles interface from TailorDB type definitions",
    dependencies: ["tailordb"] as const,

    async processType(args: {
      type: NormalizedTailorDBType;
      namespace: string;
    }): Promise<FileUtilMetadata> {
      return await processFileType(args.type);
    },

    async processTailorDBNamespace(args: {
      namespace: string;
      types: Record<string, FileUtilMetadata>;
    }): Promise<string> {
      // Return empty string for now - actual generation happens in aggregate
      const typesWithFiles = Object.values(args.types).filter((t) => t.fileFields.length > 0);
      if (typesWithFiles.length === 0) {
        return "";
      }
      // Store namespace info as JSON to be parsed in aggregate
      return JSON.stringify({
        namespace: args.namespace,
        types: typesWithFiles,
      });
    },

    aggregate(args: AggregateArgs<TailorDBInput<string>>): GeneratorResult {
      const files: GeneratorResult["files"] = [];

      // Collect all namespace metadata
      const allNamespaceData: { namespace: string; types: FileUtilMetadata[] }[] = [];

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
        const content = generateUnifiedFileUtils(allNamespaceData);
        if (content) {
          files.push({
            path: options.distPath,
            content,
          });
        }
      }

      return { files };
    },
  } satisfies TailorDBGenerator<FileUtilMetadata, string>;
}
