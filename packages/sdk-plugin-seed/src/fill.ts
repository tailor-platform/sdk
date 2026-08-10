import { loadSeedContext } from "@tailor-platform/sdk/cli";
import { configArg } from "@tailor-platform/shared/args";
import { defineAppCommand } from "@tailor-platform/shared/command";
import { logger } from "@tailor-platform/shared/logger";
import * as path from "pathe";
import { arg } from "politty";
import { z } from "zod";

export const seedFillCommand = defineAppCommand({
  name: "fill",
  description: "Fill in the values a record gets on create for JSONL seed data rows missing them.",
  notes:
    "The values come from the type itself, and nothing is validated, so rows can be filled while the " +
    "data around them is still incomplete — run `tailor seed validate` when it is ready. A value " +
    "already in the file is never replaced, and a line that gains nothing is left byte for byte as " +
    "it was. A field the type gives no value to is skipped, so one field list covers a whole data " +
    "directory.",
  args: z.strictObject({
    ...configArg,
    fields: arg(z.string().default("id"), {
      alias: "f",
      description: "Comma-separated fields to fill",
      completion: { type: "none" },
    }),
    path: arg(z.string().optional(), {
      positional: true,
      description:
        "File or directory to fill (default: the data directory under the seedPlugin distPath)",
      completion: { type: "file", extensions: ["jsonl"] },
    }),
  }),
  run: async (args) => {
    const { fillSeedData } = await import("@tailor-platform/sdk/seed");

    const fields = args.fields
      .split(",")
      .map((field) => field.trim())
      .filter(Boolean);
    if (fields.length === 0) {
      throw new Error("--fields needs at least one field name.");
    }

    let targetPath: string;
    if (args.path) {
      targetPath = path.resolve(process.cwd(), args.path);
    } else {
      const context = await loadSeedContext({ configPath: args.config });
      targetPath = path.join(context.distPath, "data");
    }

    const result = await fillSeedData({ path: targetPath, fields });
    if (result.output) {
      logger.log(result.output);
    }
    if (args.json) {
      logger.out({ path: targetPath, filled: result.filled });
    }
  },
});
