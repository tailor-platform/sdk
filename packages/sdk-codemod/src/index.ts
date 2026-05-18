#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import * as path from "pathe";
import { readPackageJSON } from "pkg-types";
import { arg, defineCommand, runMain } from "politty";
import { z } from "zod";
import { getApplicableCodemods, resolveCodemodScript } from "./registry";
import { runCodemods } from "./runner";
import type { RunOutput } from "./types";

const packageJson = await readPackageJSON(path.dirname(fileURLToPath(import.meta.url)) + "/..");

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

    if (codemods.length === 0) {
      process.stdout.write(JSON.stringify(output) + "\n");
      return;
    }

    // Resolve script paths for all applicable codemods
    const codemodEntries = codemods.map((codemod) => ({
      codemod,
      scriptPath: resolveCodemodScript(codemod.scriptPath),
    }));

    for (const { codemod } of codemodEntries) {
      process.stderr.write(`Running: ${codemod.name} - ${codemod.description}\n`);
    }

    try {
      const result = await runCodemods(codemodEntries, targetPath, dryRun);

      output.codemodsApplied = result.appliedCodemodIds.size;
      output.codemodsSkipped = codemods.length - result.appliedCodemodIds.size;
      output.filesModified = result.filesModified;
      output.warnings = result.warnings;

      if (result.changed) {
        process.stderr.write(`  ${result.filesModified.length} file(s) modified\n`);
      } else {
        process.stderr.write("  No changes needed\n");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      output.errors.push({ codemodId: "pipeline", message });
      process.stderr.write(`  Failed: ${message}\n`);
    }

    // Write JSON result to stdout
    process.stdout.write(JSON.stringify(output) + "\n");

    if (output.errors.length > 0) {
      process.exit(1);
    }
  },
});

runMain(main, { version: packageJson.version });
