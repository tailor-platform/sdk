import { arg } from "politty";
import { z } from "zod";
import { generate } from "#src/cli/commands/generate/service";
import { defineAppCommand } from "#src/cli/shared/command";

export const generateCommand = defineAppCommand({
  name: "generate",
  description: "Generate files using Tailor configuration.",
  args: z
    .object({
      config: arg(z.string().default("tailor.config.ts"), {
        alias: "c",
        description: "Path to SDK config file",
      }),
      watch: arg(z.boolean().default(false), {
        alias: "W",
        description: "Watch for type/resolver changes and regenerate",
      }),
    })
    .strict(),
  run: async (args) => {
    const { initTelemetry } = await import("#src/cli/telemetry/index");
    await initTelemetry();
    await generate({
      configPath: args.config,
      watch: args.watch,
    });
  },
});
