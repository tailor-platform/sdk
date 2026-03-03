import { defineCommand, arg } from "politty";
import { z } from "zod";
import { generate } from "@/cli/commands/generate/service";
import { commonArgs, withCommonArgs } from "@/cli/shared/args";

export const generateCommand = defineCommand({
  name: "generate",
  description: "Generate files using Tailor configuration.",
  args: z.object({
    ...commonArgs,
    config: arg(z.string().default("tailor.config.ts"), {
      alias: "c",
      description: "Path to SDK config file",
    }),
    watch: arg(z.boolean().default(false), {
      alias: "W",
      description: "Watch for type/resolver changes and regenerate",
    }),
  }),
  run: withCommonArgs(async (args) => {
    await generate({
      configPath: args.config,
      watch: args.watch,
    });
  }),
});
