#!/usr/bin/env node

import * as path from "pathe";
import { arg, defineCommand, runMain } from "politty";
import { readPackageJSON } from "pkg-types";
import { z } from "zod";
import { getApplicableCodemods } from "./registry";
import { runCodemod } from "./runner";
import type { RunOutput } from "./types";

const packageJson = await readPackageJSON(new URL("../package.json", import.meta.url));

const main = defineCommand({
  name: packageJson.name ?? "sdk-codemod",
  description: packageJson.description ?? "Codemod runner for Tailor Platform SDK upgrades",
  args: z
    .object({
      from: arg(z.string(), {
        description: "Source SDK version (the version before upgrade)",
      }),
      to: arg(z.string(), {
        description: "Target SDK version (the version after upgrade)",
      }),
      target: arg(z.string().default("."), {
        description: "Project directory to transform",
      }),
      "dry-run": arg(z.boolean().default(false), {
        alias: "d",
        description: "Preview changes without modifying files",
      }),
    })
    .strict(),
  run: async (args) => {
    const targetPath = path.resolve(args.target);
    const dryRun = args["dry-run"];

    const codemods = getApplicableCodemods(args.from, args.to);

    const output: RunOutput = {
      codemodsApplied: 0,
      codemodsSkipped: 0,
      filesModified: [],
      warnings: [],
      errors: [],
    };

    const allFilesModified = new Set<string>();
    const diffOutputs: string[] = [];

    for (const codemod of codemods) {
      process.stderr.write(`Running: ${codemod.name} - ${codemod.description}\n`);

      try {
        const result = await runCodemod(codemod, targetPath, dryRun);

        if (result.changed) {
          output.codemodsApplied++;
          for (const file of result.filesModified) {
            allFilesModified.add(file);
          }
          if (result.diffOutput) {
            diffOutputs.push(result.diffOutput);
          }
          process.stderr.write(`  ${result.filesModified.length} file(s) modified\n`);
        } else {
          output.codemodsSkipped++;
          process.stderr.write("  No changes needed\n");
        }
        output.warnings.push(...result.warnings);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        output.errors.push({ codemodId: codemod.id, message });
        process.stderr.write(`  Failed: ${message}\n`);
      }
    }

    output.filesModified = [...allFilesModified];
    if (diffOutputs.length > 0) {
      output.diffOutput = diffOutputs.join("\n\n");
    }

    // Write JSON result to stdout
    process.stdout.write(JSON.stringify(output) + "\n");

    if (output.errors.length > 0) {
      process.exit(1);
    }
  },
});

runMain(main, { version: packageJson.version });
