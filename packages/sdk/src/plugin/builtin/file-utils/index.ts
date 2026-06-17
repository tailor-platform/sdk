import { generateUnifiedFileUtils } from "./generate-file-utils";
import { processFileType } from "./process-file-type";
import type { Plugin, GeneratorResult, TailorDBReadyContext } from "#src/plugin/types";
import type { FileUtilMetadata } from "./types";

/** Unique identifier for the file utilities generator plugin. */
export const FileUtilsGeneratorID = "@tailor-platform/file-utils";

type FileUtilsPluginOptions = {
  distPath: string;
};

/**
 * Plugin that generates TypeWithFiles interface from TailorDB type definitions.
 * @param options - Plugin options
 * @param options.distPath - Output file path for generated file utilities
 * @returns Plugin instance with onTailorDBReady hook
 */
export function fileUtilsPlugin(
  options: FileUtilsPluginOptions,
): Plugin<unknown, FileUtilsPluginOptions> {
  return {
    id: FileUtilsGeneratorID,
    description: "Generates TypeWithFiles interface from TailorDB type definitions",
    pluginConfig: options,

    async onTailorDBReady(
      ctx: TailorDBReadyContext<FileUtilsPluginOptions>,
    ): Promise<GeneratorResult> {
      const namespaceData: { namespace: string; types: FileUtilMetadata[] }[] = [];

      for (const ns of ctx.tailordb) {
        const typesWithFiles: FileUtilMetadata[] = [];

        for (const type of Object.values(ns.types)) {
          const metadata = await processFileType(type);
          if (metadata.fileFields.length > 0) {
            typesWithFiles.push(metadata);
          }
        }

        if (typesWithFiles.length > 0) {
          namespaceData.push({
            namespace: ns.namespace,
            types: typesWithFiles,
          });
        }
      }

      const files: GeneratorResult["files"] = [];
      if (namespaceData.length > 0) {
        const content = generateUnifiedFileUtils(namespaceData);
        if (content) {
          files.push({
            path: ctx.pluginConfig.distPath,
            content,
          });
        }
      }

      return { files };
    },
  };
}
