import { arg } from "@politty/valibot";
import * as v from "valibot";
import { generate } from "#/cli/commands/generate/service";
import { defineAppCommand } from "#/cli/shared/command";

export const generateCommand = defineAppCommand({
  name: "generate",
  description: "Generate files using Tailor configuration.",
  args: v.strictObject({
    config: arg(v.optional(v.string(), "tailor.config.ts"), {
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
