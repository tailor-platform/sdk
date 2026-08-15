import { arg } from "@politty/valibot";
import * as path from "pathe";
import * as v from "valibot";
import { defineAppCommand } from "#/cli/shared/command";

export const upgradeCommand = defineAppCommand({
  name: "upgrade",
  description: "Run codemods to upgrade your project to a newer SDK version.",
  args: v.strictObject({
    from: arg(v.string(), {
      description: "SDK version before the upgrade (e.g., 1.33.0)",
    }),
    "dry-run": arg(v.optional(v.boolean(), false), {
      alias: "d",
      description: "Preview changes without modifying files",
    }),
    path: arg(v.optional(v.string(), "."), {
      description: "Project directory to upgrade",
      completion: { type: "directory" },
    }),
  }),
  run: async (args) => {
    const { initTelemetry } = await import("#/cli/telemetry/index");
    await initTelemetry();

    const { upgrade } = await import("./service");
    await upgrade({
      from: args.from,
      dryRun: args["dry-run"],
      path: path.resolve(args.path),
    });
  },
});
