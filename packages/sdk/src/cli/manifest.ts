/**
 * CLI command to extract a type manifest for the TS Language Service Plugin.
 *
 * Outputs a JSON manifest to stdout describing all namespaces, types, and
 * their source file locations. The TS plugin invokes this command to
 * generate `tailor-env.d.ts` without re-running the full generation pipeline.
 */

import { defineCommand, arg } from "politty";
import { z } from "zod";
import { defineApplication } from "@/cli/application";
import { loadConfig } from "@/cli/config-loader";
import { extractManifest } from "@/cli/generator/manifest";
import { logger } from "@/cli/utils/logger";
import { commonArgs, jsonArgs, withCommonArgs } from "./args";

export const manifestCommand = defineCommand({
  name: "manifest",
  description: "Extract type manifest for the TS Language Service Plugin.",
  args: z.object({
    ...commonArgs,
    ...jsonArgs,
    config: arg(z.string().default("tailor.config.ts"), {
      alias: "c",
      description: "Path to SDK config file",
    }),
  }),
  run: withCommonArgs(async (args) => {
    const { config } = await loadConfig(args.config);
    const application = defineApplication({ config });
    const manifest = await extractManifest(application, config.path);
    logger.out(manifest);
  }),
});
