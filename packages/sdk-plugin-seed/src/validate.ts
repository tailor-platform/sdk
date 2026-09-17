import * as sdkCli from "@tailor-platform/sdk/cli";
import * as path from "pathe";
import { z } from "zod";

const { loadSeedContext, configArg, defineAppCommand, logger, arg } = sdkCli;

// `withSourceLocation` reached the CLI surface in a release this plugin's peer
// range still opens below, so an older SDK resolves without it.
function attachSourceLocation(error: Error, location: sdkCli.ErrorSourceLocation): Error {
  const { withSourceLocation } = sdkCli as Partial<typeof sdkCli>;
  return typeof withSourceLocation === "function" ? withSourceLocation(error, location) : error;
}

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
      throw result.location ? attachSourceLocation(error, result.location) : error;
    }
  },
});
