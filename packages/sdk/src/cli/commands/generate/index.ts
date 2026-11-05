import { z } from "zod";
import { generate } from "#/cli/commands/generate/service";
import { configArg } from "#/cli/shared/args";
import { defineAppCommand } from "#/cli/shared/command";

export const generateCommand = defineAppCommand({
  name: "generate",
  description: "Generate files using Tailor configuration.",
  args: z.strictObject({
    ...configArg,
  }),
  run: async (args) => {
    const { initTelemetry } = await import("#/cli/telemetry/index");
    await initTelemetry();
    await generate({
      configPath: args.config,
    });
  },
});
