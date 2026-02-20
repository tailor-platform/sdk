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
    onTypeLoaded(ctx) {
      return gen.processType({
        type: ctx.type,
        namespace: ctx.namespace,
        source: ctx.source,
        plugins: ctx.plugins,
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
