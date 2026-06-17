import { generateUnifiedEnumConstants } from "./generate-enum-constants";
import { processEnumType } from "./process-enum-type";
import type { Plugin, GeneratorResult, TailorDBReadyContext } from "#src/plugin/types";
import type { EnumDefinition } from "./types";

/** Unique identifier for the enum constants generator plugin. */
export const EnumConstantsGeneratorID = "@tailor-platform/enum-constants";

type EnumConstantsPluginOptions = {
  distPath: string;
};

/**
 * Plugin that generates enum constants from TailorDB type definitions.
 * @param options - Plugin options
 * @param options.distPath - Output file path for generated constants
 * @returns Plugin instance with onTailorDBReady hook
 */
export function enumConstantsPlugin(
  options: EnumConstantsPluginOptions,
): Plugin<unknown, EnumConstantsPluginOptions> {
  return {
    id: EnumConstantsGeneratorID,
    description: "Generates enum constants from TailorDB type definitions",
    pluginConfig: options,

    async onTailorDBReady(
      ctx: TailorDBReadyContext<EnumConstantsPluginOptions>,
    ): Promise<GeneratorResult> {
      const allEnums: EnumDefinition[] = [];

      for (const ns of ctx.tailordb) {
        for (const type of Object.values(ns.types)) {
          const metadata = await processEnumType(type);
          allEnums.push(...metadata.enums);
        }
      }

      const files: GeneratorResult["files"] = [];
      if (allEnums.length > 0) {
        const content = generateUnifiedEnumConstants(allEnums);
        files.push({
          path: ctx.pluginConfig.distPath,
          content,
        });
      }

      return { files };
    },
  };
}
