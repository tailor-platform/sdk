import { arg } from "politty";
import { z } from "zod";
import { deploy } from "@/cli/commands/deploy/deploy";
import { confirmationArgs, deploymentArgs, durationArg } from "@/cli/shared/args";
import { defineAppCommand } from "@/cli/shared/command";
import { assertWritable } from "@/cli/shared/readonly-guard";

export const deployCommand = defineAppCommand({
  name: "deploy",
  aliases: ["apply"],
  description: "Deploy your application by applying the Tailor configuration.",
  args: z
    .object({
      ...deploymentArgs,
      ...confirmationArgs,
      "dry-run": arg(z.boolean().optional(), {
        alias: "d",
        description: "Run the command without making any changes",
      }),
      "no-schema-check": arg(z.boolean().optional(), {
        description: "Skip schema diff check against migration snapshots",
      }),
      "no-cache": arg(z.boolean().optional(), {
        description: "Disable bundle caching for this run",
      }),
      "clean-cache": arg(z.boolean().optional(), {
        description: "Clean the bundle cache before building",
      }),
      wait: arg(durationArg.default("5m"), {
        description:
          "Timeout for waiting until the application becomes healthy after deploy (e.g., '5m', '30s')",
      }),
      "no-wait": arg(z.boolean().optional(), {
        description: "Skip waiting for the post-deploy health check (overrides --wait)",
      }),
    })
    .strict(),
  run: async (args) => {
    await assertWritable({ profile: args.profile });
    const { initTelemetry } = await import("@/cli/telemetry");
    await initTelemetry();
    await deploy({
      workspaceId: args["workspace-id"],
      profile: args.profile,
      configPath: args.config,
      dryRun: args["dry-run"],
      yes: args.yes,
      noSchemaCheck: args["no-schema-check"],
      noCache: args["no-cache"],
      cleanCache: args["clean-cache"],
      waitTimeout: args.wait,
      noWait: args["no-wait"],
    });
  },
});
