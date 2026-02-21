import { createKyselyGenerator } from "./index";
import type { GeneratorResult } from "@/cli/generator/types";
import type { Plugin } from "@/parser/plugin-config/types";

type KyselyTypePluginOptions = {
  distPath: string;
};

/**
 * Plugin wrapper for the Kysely type generator.
 * Generates Kysely type definitions for TailorDB types.
 * @param options - Generator options
 * @param options.distPath - Output file path for generated types
 * @returns Plugin instance with generation hooks
 */
export function kyselyTypePlugin(options: KyselyTypePluginOptions): Plugin {
  const gen = createKyselyGenerator(options);
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
