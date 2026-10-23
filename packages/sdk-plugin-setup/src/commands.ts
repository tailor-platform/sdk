import {
  arg,
  confirmationArgs,
  defineAppCommand,
  defineCommand,
  logBetaWarning,
} from "@tailor-platform/sdk/cli";
import { z } from "zod";
import { checkGitHub } from "./check";
import { setupDelete } from "./delete";
import { setupEnv } from "./env";
import { checkEnv } from "./env-check";
import { PREVIEW_NAME_MAX_LENGTH, printTargetNextSteps, setupTarget } from "./generate";
import { setupRenovate } from "./renovate";
import { PACKAGE_MANAGERS, PREVIEW_REQUIREMENTS } from "./templates";
import { setupUpdate } from "./update";

const seedArgs = {
  seed: arg(z.boolean().default(false), {
    description:
      "Seed the workspace after each deploy with `tailor seed apply` (--upsert for branch and tag, --truncate for preview). Needs seedPlugin with machineUserName",
  }),
  "seed-dataset": arg(z.array(z.string().min(1)).default([]), {
    description:
      "Seed dataset to apply on top of the base seed data (repeatable, applied in order); implies --seed",
  }),
};

function seedOption(args: { seed: boolean; "seed-dataset": string[] }) {
  return args.seed || args["seed-dataset"].length > 0
    ? { datasets: args["seed-dataset"] }
    : undefined;
}

const checkCommand = defineAppCommand({
  name: "check",
  description: "Audit generated workflows for drift against the current config/repo (read-only).",
  args: z.strictObject({}),
  run: async () => {
    logBetaWarning("setup");
    await checkGitHub({ outputDir: process.cwd() });
  },
});

const envCommand = defineAppCommand({
  name: "env",
  description:
    "Print the secrets and variables each GitHub Environment used by the generated workflows needs, or check which are registered (read-only).",
  args: z.strictObject({
    format: arg(z.enum(["gh", "terraform"]).default("gh"), {
      description: "Output format: gh CLI commands, or Terraform (integrations/github provider)",
    }),
    environment: arg(z.array(z.string().min(1)).default([]), {
      description: "Only print or check this GitHub Environment. Repeat for several",
    }),
    check: arg(z.boolean().default(false), {
      description:
        "Check with gh which of them are registered in GitHub, and print gh commands for the missing ones; fails when a required one is missing",
    }),
  }),
  run: (args) => {
    logBetaWarning("setup");
    if (args.check) {
      if (args.format === "terraform") {
        throw new Error(
          "--check cannot be combined with --format terraform: it reads GitHub with gh and prints gh commands for what is missing.",
        );
      }
      checkEnv({ outputDir: process.cwd(), environments: args.environment });
      return;
    }
    setupEnv({ outputDir: process.cwd(), format: args.format, environments: args.environment });
  },
});

const packageManagerArg = arg(z.enum(PACKAGE_MANAGERS).optional(), {
  description: `Package manager the workflow uses: ${new Intl.ListFormat("en", { type: "disjunction" }).format(PACKAGE_MANAGERS)} (defaults to the one the lockfile or package.json at the repository root names)`,
});

const branchCommand = defineAppCommand({
  name: "branch",
  description: "Generate a branch-target deploy workflow (push to branch triggers deploy).",
  args: z.strictObject({
    name: arg(z.string().min(1).optional(), {
      alias: "n",
      description: "Name (defaults to the config 'name')",
    }),
    target: arg(z.string().min(1).optional(), {
      description: "Deploy trigger branch (defaults to the detected default branch)",
    }),
    environment: arg(z.string().min(1).optional(), {
      description: "GitHub Environment for the plan/deploy jobs (defaults to the workspace name)",
    }),
    "package-manager": packageManagerArg,
    "erd-preview": arg(z.boolean().default(false), {
      description: "Add PR ERD viewer artifacts with current/diff previews for TailorDB namespaces",
    }),
    ghes: arg(z.boolean().default(false), {
      description:
        "Upload the ERD preview with upload-artifact v3, which GitHub Enterprise Server supports (requires --erd-preview)",
    }),
    "restrict-dispatch": arg(z.boolean().default(false), {
      description:
        "Deploy on manual dispatch only from the target branch; dry runs stay unrestricted",
    }),
    "migration-test": arg(z.boolean().default(false), {
      description:
        "Add a job that runs `tailordb migration test` against cloned data when a PR gets the migration test label, then removes the label (requires TailorDB migrations)",
    }),
    "migration-test-label": arg(z.string().optional(), {
      description: "PR label that triggers the migration test (defaults to tailor:migration-test)",
    }),
    "migration-test-environment": arg(z.string().min(1).optional(), {
      description:
        "GitHub Environment for the migration test job, holding its own credentials and TAILOR_PLATFORM_MIGRATION_TEST_SOURCE_WORKSPACE_ID (defaults to the plan/deploy environment and its workspace)",
    }),
    paths: arg(z.array(z.string().min(1)).default([]), {
      description:
        "Extra path pattern (repeatable) whose changes also run the generated jobs, besides the app directories. Supports `*`, `**`, and a leading `!` to exclude",
    }),
    dir: arg(z.array(z.string().min(1)).default(["."]), {
      alias: "d",
      description:
        "App directory (for monorepo setups). Repeat to deploy several apps together in one multi-config run; --name is then required",
    }),
    ...seedArgs,
    force: arg(z.boolean().default(false), {
      description:
        "Reset hand edits to SDK-managed parts (your own jobs and steps are kept) / take over unmanaged files",
    }),
  }),
  run: async (args) => {
    logBetaWarning("setup");
    const result = await setupTarget({
      kind: "branch",
      workspaceName: args.name,
      branch: args.target,
      environment: args.environment,
      packageManager: args["package-manager"],
      erdPreview: args["erd-preview"],
      ghes: args.ghes,
      restrictDispatch: args["restrict-dispatch"],
      migrationTest: args["migration-test"],
      migrationTestLabel: args["migration-test-label"],
      migrationTestEnvironment: args["migration-test-environment"],
      dir: args.dir,
      extraPaths: args.paths,
      seed: seedOption(args),
      force: args.force,
      outputDir: process.cwd(),
    });
    printTargetNextSteps(result);
  },
});

const tagCommand = defineAppCommand({
  name: "tag",
  description: "Generate a tag-target deploy workflow (tag push triggers deploy).",
  args: z.strictObject({
    name: arg(z.string().min(1).optional(), {
      alias: "n",
      description: "Name (defaults to the config 'name')",
    }),
    "tag-pattern": arg(z.string().min(1).default("v*"), {
      description: "Tag glob to match (defaults to v*)",
    }),
    branch: arg(z.string().min(1).optional(), {
      description: "Tag-reachability guard branch (no guard when omitted)",
    }),
    "restrict-dispatch": arg(z.boolean().default(false), {
      description:
        "Deploy on manual dispatch only from a tag (reachable from --branch when set); dry runs stay unrestricted",
    }),
    environment: arg(z.string().min(1).optional(), {
      description: "GitHub Environment for the plan/deploy jobs (defaults to the workspace name)",
    }),
    "package-manager": packageManagerArg,
    dir: arg(z.array(z.string().min(1)).default(["."]), {
      alias: "d",
      description:
        "App directory (for monorepo setups). Repeat to deploy several apps together in one multi-config run; --name is then required",
    }),
    ...seedArgs,
    force: arg(z.boolean().default(false), {
      description:
        "Reset hand edits to SDK-managed parts (your own jobs and steps are kept) / take over unmanaged files",
    }),
  }),
  run: async (args) => {
    logBetaWarning("setup");
    const result = await setupTarget({
      kind: "tag",
      workspaceName: args.name,
      tagPattern: args["tag-pattern"],
      branch: args.branch,
      restrictDispatch: args["restrict-dispatch"],
      environment: args.environment,
      packageManager: args["package-manager"],
      dir: args.dir,
      seed: seedOption(args),
      force: args.force,
      outputDir: process.cwd(),
    });
    printTargetNextSteps(result);
  },
});

const previewCommand = defineAppCommand({
  name: "preview",
  description: "Generate a preview workflow (PR open/sync triggers deploy to a per-PR workspace).",
  args: z.strictObject({
    name: arg(z.string().min(1).optional(), {
      alias: "n",
      description: `Name (defaults to the config 'name'); at most ${String(PREVIEW_NAME_MAX_LENGTH)} characters`,
    }),
    branch: arg(z.string().min(1).optional(), {
      description: "Branch to filter PRs by (defaults to the detected default branch)",
    }),
    region: arg(z.string().min(1), {
      description: "Workspace region for preview workspace creation (e.g. us-west). Required.",
    }),
    require: arg(z.enum(PREVIEW_REQUIREMENTS).optional(), {
      description:
        "What a PR must satisfy before its preview deploys: `ready` skips draft PRs and deploys when the PR is marked ready for review, `label` deploys only PRs labeled `tailor:preview`. By default every PR, drafts included, gets a preview.",
    }),
    environment: arg(z.string().min(1).optional(), {
      description: "GitHub Environment for the preview jobs (defaults to the workspace name)",
    }),
    "package-manager": packageManagerArg,
    paths: arg(z.array(z.string().min(1)).default([]), {
      description:
        "Extra path pattern (repeatable) whose changes also run the generated jobs, besides the app directories. Supports `*`, `**`, and a leading `!` to exclude",
    }),
    dir: arg(z.array(z.string().min(1)).default(["."]), {
      alias: "d",
      description:
        "App directory (for monorepo setups). Repeat to deploy several apps together in one multi-config run; --name is then required",
    }),
    ...seedArgs,
    force: arg(z.boolean().default(false), {
      description:
        "Reset hand edits to SDK-managed parts (your own jobs and steps are kept) / take over unmanaged files",
    }),
  }),
  run: async (args) => {
    logBetaWarning("setup");
    const result = await setupTarget({
      kind: "preview",
      workspaceName: args.name,
      branch: args.branch,
      region: args.region,
      require: args.require,
      environment: args.environment,
      packageManager: args["package-manager"],
      dir: args.dir,
      extraPaths: args.paths,
      seed: seedOption(args),
      force: args.force,
      outputDir: process.cwd(),
    });
    printTargetNextSteps(result);
  },
});

const updateCommand = defineAppCommand({
  name: "update",
  description:
    "Regenerate every workflow in .github/tailor.lock with the flags it was generated with.",
  args: z.strictObject({
    force: arg(z.boolean().default(false), {
      description:
        "Reset hand edits to SDK-managed parts of every target (your own jobs and steps are kept)",
    }),
  }),
  run: async (args) => {
    logBetaWarning("setup");
    await setupUpdate({ force: args.force, outputDir: process.cwd() });
  },
});

const DEPS_PROVIDERS = ["renovate"] as const;

const depsProviders: Record<
  (typeof DEPS_PROVIDERS)[number],
  (options: { outputDir: string }) => Promise<void>
> = {
  renovate: setupRenovate,
};

const depsCommand = defineAppCommand({
  name: "deps",
  description: "Generate a dependency update config for Tailor dependency and workflow updates.",
  args: z.strictObject({
    provider: arg(z.enum(DEPS_PROVIDERS).default("renovate"), {
      description: "Dependency update provider to configure",
    }),
  }),
  run: async (args) => {
    logBetaWarning("setup");
    await depsProviders[args.provider]({ outputDir: process.cwd() });
  },
});

const deleteCommand = defineAppCommand({
  name: "delete",
  description: "Delete managed workflow file(s) and their .github/tailor.lock entries.",
  args: z.strictObject({
    ...confirmationArgs,
    files: arg(z.string().array().min(1), {
      positional: true,
      description: "Workflow file(s) to delete, as generated under .github/workflows",
    }),
  }),
  run: async (args) => {
    logBetaWarning("setup");
    await setupDelete({ files: args.files, yes: args.yes, outputDir: process.cwd() });
  },
});

const ciCommand = defineCommand({
  name: "ci",
  description:
    "Generate a GitHub Actions deploy workflow, tracked in .github/tailor.lock and drift-checked by `setup check`, and list the GitHub Environment settings it needs.",
  subCommands: {
    branch: branchCommand,
    tag: tagCommand,
    preview: previewCommand,
    env: envCommand,
  },
});

export const setupSubCommands = {
  // GitHub Actions generators: tracked in .github/tailor.lock and drift-checked by `setup check`.
  ci: ciCommand,
  // Standalone generator: writes a user-owned file, not tracked in the lock.
  deps: depsCommand,
  // Cross-cutting operations over lock-tracked files.
  check: checkCommand,
  update: updateCommand,
  delete: deleteCommand,
};
