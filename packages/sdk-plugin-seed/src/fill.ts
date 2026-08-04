import { loadSeedContext } from "@tailor-platform/sdk/cli";
import * as path from "pathe";
import { arg } from "politty";
import { z } from "zod";
import { configArg } from "./shared/args";
import { defineAppCommand } from "./shared/command";
import { logger } from "./shared/logger";

export const seedFillCommand = defineAppCommand({
  name: "fill",
  description: "Fill in the values a record gets on create for JSONL seed data rows missing them.",
  notes:
    "Rows are validated first: invalid data is reported and left untouched. Only the named fields " +
    "take a new value, so every other field keeps the value its line already had, though a rewritten " +
    "file has its key order and JSON formatting normalized. A field the type does not give every row " +
    "a value for is skipped for that type, so one field list covers a whole data directory.",
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

    const result = await fillSeedData({ path: targetPath, fields, verbose: args.verbose });
    if (result.output) {
      logger.log(result.output);
    }
    if (args.json) {
      logger.out({
        valid: result.valid,
        path: targetPath,
        filled: result.valid ? result.filled : [],
      });
    }
    if (!result.valid) {
      throw new Error(result.error);
    }
  },
});
