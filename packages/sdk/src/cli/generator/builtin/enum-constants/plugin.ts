import { createEnumConstantsGenerator } from "./index";
import type { GeneratorResult } from "@/cli/generator/types";
import type { Plugin } from "@/parser/plugin-config/types";

type EnumConstantsPluginOptions = {
  distPath: string;
};

/**
 * Plugin wrapper for the enum constants generator.
 * Generates enum constants from TailorDB type definitions.
 * @param options - Generator options
 * @param options.distPath - Output file path for generated constants
 * @returns Plugin instance with generation hooks
 */
export function enumConstantsPlugin(options: EnumConstantsPluginOptions): Plugin {
  const gen = createEnumConstantsGenerator(options);
  return {
    id: gen.id,
    description: gen.description,
    pluginConfig: options,
    async onTailorDBReady(ctx): Promise<GeneratorResult> {
      const tailordbResults = await Promise.all(
        ctx.tailordb.map(async (ns) => {
          const typeResults: Record<string, Awaited<ReturnType<typeof gen.processType>>> = {};
          for (const [name, type] of Object.entries(ns.types)) {
            typeResults[name] = await gen.processType({ type, namespace: ns.namespace });
          }
          const types = gen.processTailorDBNamespace
            ? await gen.processTailorDBNamespace({ namespace: ns.namespace, types: typeResults })
            : typeResults;
          return { namespace: ns.namespace, types };
        }),
      );
      return gen.aggregate({
        input: {
          tailordb: tailordbResults as Parameters<typeof gen.aggregate>[0]["input"]["tailordb"],
          auth: ctx.auth,
        },
        baseDir: ctx.baseDir,
        configPath: ctx.configPath,
      });
    },
  };
}
