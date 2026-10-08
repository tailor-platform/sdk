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
import { printTargetNextSteps, setupTarget } from "./generate";
import { setupRenovate } from "./renovate";
import { setupUpdate } from "./update";

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
    "Print the secrets and variables each GitHub Environment used by the generated workflows needs (read-only).",
  args: z.strictObject({
    format: arg(z.enum(["gh", "terraform"]).default("gh"), {
      description: "Output format: gh CLI commands, or Terraform (integrations/github provider)",
    }),
    environment: arg(z.array(z.string().min(1)).default([]), {
      description: "Only print this GitHub Environment. Repeat to print several",
    }),
  }),
  run: (args) => {
    logBetaWarning("setup");
    setupEnv({ outputDir: process.cwd(), format: args.format, environments: args.environment });
  },
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
    "erd-preview": arg(z.boolean().default(false), {
      description: "Add PR ERD viewer artifacts with current/diff previews for TailorDB namespaces",
    }),
    "restrict-dispatch": arg(z.boolean().default(false), {
      description:
        "Deploy on manual dispatch only from the target branch; dry runs stay unrestricted",
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
      erdPreview: args["erd-preview"],
      restrictDispatch: args["restrict-dispatch"],
      dir: args.dir,
      extraPaths: args.paths,
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
    dir: arg(z.array(z.string().min(1)).default(["."]), {
      alias: "d",
      description:
        "App directory (for monorepo setups). Repeat to deploy several apps together in one multi-config run; --name is then required",
    }),
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
      dir: args.dir,
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
      description: "Name (defaults to the config 'name'); at most 50 characters",
    }),
    branch: arg(z.string().min(1).optional(), {
      description: "Branch to filter PRs by (defaults to the detected default branch)",
    }),
    region: arg(z.string().min(1), {
      description: "Workspace region for preview workspace creation (e.g. us-west). Required.",
    }),
    "require-preview-label": arg(z.boolean().default(false), {
      description: "Deploy preview only for PRs labeled `tailor:preview` instead of all PRs.",
    }),
    environment: arg(z.string().min(1).optional(), {
      description: "GitHub Environment for the preview jobs (defaults to the workspace name)",
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
      requirePreviewLabel: args["require-preview-label"],
      environment: args.environment,
      dir: args.dir,
      extraPaths: args.paths,
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
