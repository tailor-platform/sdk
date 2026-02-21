import { createSeedGenerator } from "./index";
import type { GeneratorResult } from "@/cli/generator/types";
import type { Plugin } from "@/parser/plugin-config/types";

type SeedPluginOptions = {
  distPath: string;
  machineUserName?: string;
};

/**
 * Plugin wrapper for the seed generator.
 * Generates seed data files with Kysely batch insert and tailor.idp.Client for _User.
 * @param options - Generator options
 * @param options.distPath - Output directory path for generated seed files
 * @param options.machineUserName - Default machine user name for authentication
 * @returns Plugin instance with generation hooks
 */
export function seedPlugin(options: SeedPluginOptions): Plugin {
  const gen = createSeedGenerator(options);
  return {
    id: gen.id,
    description: gen.description,
    pluginConfig: options,
    async onTailorDBReady(ctx): Promise<GeneratorResult> {
      const tailordbResults = await Promise.all(
        ctx.tailordb.map(async (ns) => {
          const typeResults: Record<string, Awaited<ReturnType<typeof gen.processType>>> = {};
          for (const [name, type] of Object.entries(ns.types)) {
            typeResults[name] = await gen.processType({
              type,
              namespace: ns.namespace,
              source: ns.sourceInfo.get(name)!,
              plugins: ns.pluginAttachments.get(name) ?? [],
            });
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
