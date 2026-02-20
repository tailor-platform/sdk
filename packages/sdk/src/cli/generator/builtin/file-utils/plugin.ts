import { createFileUtilsGenerator } from "./index";
import type { GeneratorResult } from "@/cli/generator/types";
import type { Plugin } from "@/parser/plugin-config/types";

type FileUtilsPluginOptions = {
  distPath: string;
};

/**
 * Plugin wrapper for the file utilities generator.
 * Generates TypeWithFiles interface from TailorDB type definitions.
 * @param options - Generator options
 * @param options.distPath - Output file path for generated file utilities
 * @returns Plugin instance with generation hooks
 */
export function fileUtilsPlugin(options: FileUtilsPluginOptions): Plugin {
  const gen = createFileUtilsGenerator(options);
  return {
    id: gen.id,
    description: gen.description,
    pluginConfig: options,
    onTypeLoaded(ctx) {
      return gen.processType({
        type: ctx.type,
        namespace: ctx.namespace,
      });
    },
    onTailorDBNamespaceLoaded(ctx) {
      // ctx.types values are produced by this generator's onTypeLoaded, cast is safe
      return gen.processTailorDBNamespace?.({
        namespace: ctx.namespace,
        types: ctx.types as Parameters<typeof gen.processTailorDBNamespace>[0]["types"],
      });
    },
    generate(ctx): GeneratorResult | Promise<GeneratorResult> {
      return gen.aggregate({
        input: {
          tailordb: (ctx.tailordb ?? []) as Parameters<
            typeof gen.aggregate
          >[0]["input"]["tailordb"],
          auth: ctx.auth,
        },
        baseDir: ctx.baseDir,
        configPath: ctx.configPath,
      });
    },
  };
}
