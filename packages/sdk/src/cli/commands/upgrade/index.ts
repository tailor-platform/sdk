import * as path from "pathe";
import { arg } from "politty";
import { z } from "zod";
import { defineAppCommand } from "@/cli/shared/command";

export const upgradeCommand = defineAppCommand({
  name: "upgrade",
  description: "Run codemods to upgrade your project to a newer SDK version.",
  args: z
    .object({
      to: arg(z.string().optional(), {
        description:
          "Target SDK version to upgrade to. Defaults to the version declared in package.json.",
      }),
      "dry-run": arg(z.boolean().default(false), {
        alias: "d",
        description: "Preview changes without modifying files",
      }),
      path: arg(z.string().default("."), {
        description: "Project directory to upgrade",
        completion: { type: "directory" },
      }),
    })
    .strict(),
  run: async (args) => {
    const { initTelemetry } = await import("@/cli/telemetry");
    await initTelemetry();

    const { upgrade } = await import("./service");
    await upgrade({
      to: args.to,
      dryRun: args["dry-run"],
      path: path.resolve(args.path),
    });
  },
});
