import { loadSeedContext } from "@tailor-platform/sdk/cli";
import * as path from "pathe";
import { arg } from "politty";
import { z } from "zod";
import { configArg } from "./shared/args";
import { defineAppCommand } from "./shared/command";
import { logger } from "./shared/logger";

export const seedValidateCommand = defineAppCommand({
  name: "validate",
  description: "Validate JSONL seed data against generated schema definitions.",
  args: z.strictObject({
    ...configArg,
    path: arg(z.string().optional(), {
      positional: true,
      description:
        "File or directory to validate (default: the data directory under the seedPlugin distPath)",
      completion: { type: "file", extensions: ["jsonl"] },
    }),
  }),
  run: async (args) => {
    const { validateSeedData } = await import("@tailor-platform/sdk/seed");

    let targetPath: string;
    if (args.path) {
      targetPath = path.resolve(process.cwd(), args.path);
    } else {
      const context = await loadSeedContext({ configPath: args.config });
      targetPath = path.join(context.distPath, "data");
    }

    const result = await validateSeedData({ path: targetPath, verbose: args.verbose });
    if (result.output) {
      logger.log(result.output);
    }
    if (args.json) {
      logger.out({ valid: result.valid, path: targetPath });
    }
    if (!result.valid) {
      // The report already carries its own markers, and `format()` is what keeps
      // the CLI from printing an error marker in front of them.
      const error = new Error(result.error) as Error & { format: () => string };
      error.format = () => result.error;
      throw error;
    }
  },
});
