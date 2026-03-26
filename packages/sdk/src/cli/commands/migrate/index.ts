import * as path from "pathe";
import { arg } from "politty";
import { z } from "zod";
import { defineAppCommand } from "@/cli/shared/command";

export const migrateCommand = defineAppCommand({
  name: "migrate",
  description: "Run codemods to migrate your project to a newer SDK version.",
  args: z
    .object({
      to: arg(z.string(), {
        description: "Target SDK version to migrate to (e.g., 2.0.0)",
      }),
      "dry-run": arg(z.boolean().default(false), {
        alias: "d",
        description: "Preview changes without modifying files",
      }),
      path: arg(z.string().default("."), {
        description: "Project directory to migrate",
        completion: { type: "directory" },
      }),
    })
    .strict(),
  run: async (args) => {
    const { initTelemetry } = await import("@/cli/telemetry");
    await initTelemetry();

    const { migrate } = await import("./service");
    await migrate({
      to: args.to,
      dryRun: args["dry-run"],
      path: path.resolve(args.path),
    });
  },
});
