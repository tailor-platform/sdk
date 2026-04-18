import { arg } from "politty";
import { z } from "zod";
import { apply } from "@/cli/commands/apply/apply";
import { prepareBasePlan } from "@/cli/commands/apply/merge-plan-setup";
import { confirmationArgs, deploymentArgs } from "@/cli/shared/args";
import { defineAppCommand } from "@/cli/shared/command";

export const applyCommand = defineAppCommand({
  name: "apply",
  description: "Apply Tailor configuration to deploy your application.",
  notes: `Use \`--base\` to preview the plan **as if the current branch were merged into its base branch**.
The command creates a temporary git worktree, merges HEAD into the base ref (no commit),
and runs the plan against that merged state. This is useful in CI for previewing the
deployment impact of a pull request before merging.

The base ref is auto-detected from \`GITHUB_BASE_REF\` (set by GitHub Actions on
pull_request events), then \`gh pr view\`, and finally \`origin/HEAD\`. Override
with \`--base-ref <ref>\`. \`--base\` implies \`--dry-run\` and disables caching.

If any lockfile (\`pnpm-lock.yaml\`, \`package-lock.json\`, \`yarn.lock\`, \`bun.lock\`) or
any workspace \`package.json\` differs between source and merge target, the command
aborts without running. Install the merged dependencies first, then retry.`,
  examples: [
    {
      cmd: "--base",
      desc: "Plan against current HEAD merged into the auto-detected base branch",
    },
    {
      cmd: "--base-ref origin/main",
      desc: "Plan against current HEAD merged into a specific base ref",
    },
  ],
  args: z
    .object({
      ...deploymentArgs,
      ...confirmationArgs,
      "dry-run": arg(z.boolean().optional(), {
        alias: "d",
        description: "Run the command without making any changes",
      }),
      "no-schema-check": arg(z.boolean().optional(), {
        description: "Skip schema diff check against migration snapshots",
      }),
      "no-cache": arg(z.boolean().optional(), {
        description: "Disable bundle caching for this run",
      }),
      "clean-cache": arg(z.boolean().optional(), {
        description: "Clean the bundle cache before building",
      }),
      base: arg(z.boolean().optional(), {
        description:
          "Plan against the config as it would look after merging current HEAD into the base ref. Implies --dry-run.",
      }),
      "base-ref": arg(z.string().optional(), {
        description:
          "Override the base ref for --base (implies --base when given without --base). Defaults to auto-detection (GITHUB_BASE_REF, gh PR base, then origin/HEAD).",
      }),
    })
    .strict(),
  run: async (args) => {
    const { initTelemetry } = await import("@/cli/telemetry");
    await initTelemetry();

    const baseRef = args["base-ref"];
    const basePlan = args.base === true || baseRef !== undefined;
    if (!basePlan) {
      await apply({
        workspaceId: args["workspace-id"],
        profile: args.profile,
        configPath: args.config,
        dryRun: args["dry-run"],
        yes: args.yes,
        noSchemaCheck: args["no-schema-check"],
        noCache: args["no-cache"],
        cleanCache: args["clean-cache"],
      });
      return;
    }

    const prepared = await prepareBasePlan({ baseRef, configPath: args.config });
    const originalCwd = process.cwd();
    let chdirDone = false;
    try {
      // File loaders (TailorDB, resolvers, executors, workflows) resolve `files`
      // globs via process.cwd(); chdir to the same subdirectory inside the
      // merged worktree so relative globs keep working from (e.g.) `example/`
      // rather than the repo root.
      process.chdir(prepared.cwd);
      chdirDone = true;
      await apply({
        workspaceId: args["workspace-id"],
        profile: args.profile,
        configPath: prepared.configPath,
        dryRun: true,
        // `--base` is a CI-friendly preview that never mutates the workspace;
        // auto-confirm so downstream prompts (deletions, owner conflicts) do
        // not turn the read-only plan into an error in non-interactive shells.
        yes: true,
        noSchemaCheck: args["no-schema-check"],
        noCache: true,
        cleanCache: args["clean-cache"],
      });
    } finally {
      try {
        if (chdirDone) process.chdir(originalCwd);
      } finally {
        await prepared.worktree.dispose();
      }
    }
  },
});
