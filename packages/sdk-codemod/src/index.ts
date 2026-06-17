#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import * as path from "pathe";
import { readPackageJSON } from "pkg-types";
import { arg, defineCommand, runMain } from "politty";
import { z } from "zod";
import { getApplicableCodemods, resolveCodemodScript } from "./registry";
import { runCodemods } from "./runner";
import type { LlmReview, RunOutput } from "./types";

const packageJson = await readPackageJSON(path.dirname(fileURLToPath(import.meta.url)) + "/..");

/**
 * Print an LLM-assisted review task to stderr: the flagged files plus the
 * codemod's migration prompt, ready to hand to an LLM for the cases the
 * deterministic transform could not complete on its own.
 * @param review - The review task (codemod id, prompt, files)
 */
function printLlmReview(review: LlmReview): void {
  process.stderr.write(
    `\n🤖 LLM-assisted review suggested (${review.codemodId}) — the codemod cannot safely migrate these automatically:\n`,
  );
  for (const file of review.files) {
    process.stderr.write(`  - ${file}\n`);
  }
  process.stderr.write(`\nPrompt for an LLM:\n${review.prompt.trim()}\n`);
}

const main = defineCommand({
  name: packageJson.name ?? "sdk-codemod",
  description: packageJson.description ?? "Codemod runner for Tailor Platform SDK upgrades",
  notes: `Applies the codemods matching the \`--from\`/\`--to\` version range to the
\`--target\` directory, then writes a JSON summary to \`stdout\`:

- \`filesModified\`: files a codemod changed
- \`warnings\`: files that may still need manual migration
- \`llmReviews\`: changes the codemods could not fully migrate on their own. Each
  entry has the affected \`files\` and a \`prompt\` — hand the prompt and files to
  an LLM (or follow it yourself) to finish those cases.

Progress, warnings, and the LLM-review prompts are also printed to \`stderr\` in
human-readable form, so \`stdout\` stays pure JSON for piping.`,
  examples: [
    {
      cmd: "--from 1.64.0 --to 2.0.0",
      desc: "Apply every codemod for the 1.64.0 -> 2.0.0 upgrade to the current project",
    },
    {
      cmd: "--from 1.64.0 --to 2.0.0 --dry-run",
      desc: "Preview the changes and any LLM-review prompts without writing files",
    },
  ],
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
      llmReviews: [],
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
      output.llmReviews = result.llmReviews;

      if (result.changed) {
        process.stderr.write(`  ${result.filesModified.length} file(s) modified\n`);
      } else {
        process.stderr.write("  No changes needed\n");
      }

      for (const review of output.llmReviews) {
        printLlmReview(review);
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

void runMain(main, { version: packageJson.version });
