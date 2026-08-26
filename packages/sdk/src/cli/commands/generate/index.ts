import { arg } from "politty";
import { z } from "zod";
import { generate } from "#/cli/commands/generate/service";
import { defineAppCommand } from "#/cli/shared/command";

export const generateCommand = defineAppCommand({
  name: "generate",
  description: "Generate files using Tailor configuration.",
  args: z.strictObject({
    config: arg(z.string().default("tailor.config.ts"), {
      alias: "c",
      description: "Path to SDK config file",
    }),
  }),
  run: async (args) => {
    const { initTelemetry } = await import("#/cli/telemetry/index");
    await initTelemetry();
    await generate({
      configPath: args.config,
    });
  },
});
