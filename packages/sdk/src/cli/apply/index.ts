import { defineCommand } from "citty";
import { defineApplication } from "@/cli/application";
import { Bundler, type BundlerConfig } from "@/cli/bundler";
import { ExecutorLoader } from "@/cli/bundler/executor/loader";
import { ExecutorTransformer } from "@/cli/bundler/executor/transformer";
import { ResolverLoader } from "@/cli/bundler/resolver/loader";
import { CodeTransformer } from "@/cli/bundler/resolver/transformer";
import { loadConfig } from "@/cli/config-loader";
import { generateUserTypes } from "@/cli/type-generator";
import { commonArgs, withCommonArgs } from "../args";
import { initOperatorClient } from "../client";
import { loadAccessToken, loadConfigPath, loadWorkspaceId } from "../context";
import { applyApplication, planApplication } from "./services/application";
import { applyAuth, planAuth } from "./services/auth";
import {
  confirmOwnershipConflicts,
  confirmUnlabeledResources,
  type OwnershipConflict,
  type UnlabeledResource,
} from "./services/confirm";
import { applyExecutor, planExecutor } from "./services/executor";
import { applyIdP, planIdP } from "./services/idp";
import { applyPipeline, planPipeline } from "./services/resolver";
import {
  applyStaticWebsite,
  planStaticWebsite,
} from "./services/staticwebsite";
import { applyTailorDB, planTailorDB } from "./services/tailordb";
import type { Application } from "@/cli/application";
import type { FileLoadConfig } from "@/cli/application/file-loader";
import type { OperatorClient } from "@/cli/client";
import type { Executor } from "@/parser/service/executor";
import type { Resolver } from "@/parser/service/resolver";

export interface ApplyOptions {
  workspaceId?: string;
  profile?: string;
  configPath?: string;
  dryRun?: boolean;
  yes?: boolean;
  // NOTE(remiposo): Provide an option to run build-only for testing purposes.
  // This could potentially be exposed as a CLI option.
  buildOnly?: boolean;
}

export interface PlanContext {
  client: OperatorClient;
  workspaceId: string;
  application: Readonly<Application>;
}

export type ApplyPhase = "create-update" | "delete";

export async function apply(options?: ApplyOptions) {
  // Load and validate options
  const configPath = loadConfigPath(options?.configPath);
  const { config } = await loadConfig(configPath);
  const dryRun = options?.dryRun ?? false;
  const yes = options?.yes ?? false;
  const buildOnly = options?.buildOnly ?? false;

  // Generate user types from loaded config
  await generateUserTypes(config, configPath);
  const application = defineApplication(config);

  // Build functions
  for (const app of application.applications) {
    for (const pipeline of app.resolverServices) {
      await buildPipeline(pipeline.namespace, pipeline.config);
    }
  }
  if (application.executorService) {
    await buildExecutor(application.executorService.config);
  }
  if (buildOnly) return;

  // Initialize client
  const accessToken = await loadAccessToken({
    useProfile: true,
    profile: options?.profile,
  });
  const client = await initOperatorClient(accessToken);
  const workspaceId = loadWorkspaceId({
    workspaceId: options?.workspaceId,
    profile: options?.profile,
  });

  // Phase 1: Plan
  const ctx: PlanContext = { client, workspaceId, application };
  const tailorDB = await planTailorDB(ctx);
  const staticWebsite = await planStaticWebsite(ctx);
  const idp = await planIdP(ctx);
  const auth = await planAuth(ctx);
  const pipeline = await planPipeline(ctx);
  const app = await planApplication(ctx);
  const executor = await planExecutor(ctx);

  // Collect all conflicts and unlabeled resources
  const allConflicts: OwnershipConflict[] = [
    ...tailorDB.conflicts,
    ...staticWebsite.conflicts,
    ...idp.conflicts,
    ...auth.conflicts,
    ...pipeline.conflicts,
    ...executor.conflicts,
  ];
  const allUnlabeled: UnlabeledResource[] = [
    ...tailorDB.unlabeled,
    ...staticWebsite.unlabeled,
    ...idp.unlabeled,
    ...auth.unlabeled,
    ...pipeline.unlabeled,
    ...executor.unlabeled,
  ];

  // Delete renamed applications
  const orphanedOwners = new Set([
    ...tailorDB.orphanedOwners,
    ...staticWebsite.orphanedOwners,
    ...idp.orphanedOwners,
    ...auth.orphanedOwners,
    ...pipeline.orphanedOwners,
    ...executor.orphanedOwners,
  ]);
  const conflictOwners = new Set(allConflicts.map((c) => c.currentOwner));
  const emptyApps = [...conflictOwners].filter(
    (owner) => !orphanedOwners.has(owner),
  );
  for (const emptyApp of emptyApps) {
    app.deletes.push({
      name: emptyApp,
      request: {
        workspaceId,
        applicationName: emptyApp,
      },
    });
  }

  // Confirm all conflicts and unlabeled resources at once
  await confirmOwnershipConflicts(allConflicts, yes);
  await confirmUnlabeledResources(allUnlabeled, yes);

  if (dryRun) {
    console.log("Dry run enabled. No changes applied.");
    return;
  }

  // Phase 2: Apply Create/Update
  await applyTailorDB(client, tailorDB, "create-update");
  await applyStaticWebsite(client, staticWebsite, "create-update");
  await applyIdP(client, idp, "create-update");
  await applyAuth(client, auth, "create-update");
  await applyPipeline(client, pipeline, "create-update");
  await applyApplication(client, app, "create-update");
  await applyExecutor(client, executor, "create-update");

  // Phase 3: Apply Delete in reverse order
  await applyExecutor(client, executor, "delete");
  await applyApplication(client, app, "delete");
  await applyPipeline(client, pipeline, "delete");
  await applyAuth(client, auth, "delete");
  await applyIdP(client, idp, "delete");
  await applyStaticWebsite(client, staticWebsite, "delete");
  await applyTailorDB(client, tailorDB, "delete");

  console.log("Successfully applied changes.");
}

async function buildPipeline(namespace: string, config: FileLoadConfig) {
  const bundlerConfig: BundlerConfig<Resolver> = {
    namespace,
    serviceConfig: config,
    loader: new ResolverLoader(),
    transformer: new CodeTransformer(),
    outputDirs: {
      preBundle: "resolvers",
      postBundle: "functions",
    },
  };
  const bundler = new Bundler(bundlerConfig);
  await bundler.bundle();
}

async function buildExecutor(config: FileLoadConfig) {
  const bundlerConfig: BundlerConfig<Executor> = {
    namespace: "executor",
    serviceConfig: config,
    loader: new ExecutorLoader(),
    transformer: new ExecutorTransformer(),
    outputDirs: {
      preBundle: "executors",
      postBundle: "executors",
    },
    shouldProcess: (executor) =>
      ["function", "jobFunction"].includes(executor.operation.kind),
  };
  const bundler = new Bundler(bundlerConfig);
  await bundler.bundle();
}

export const applyCommand = defineCommand({
  meta: {
    name: "apply",
    description: "Apply Tailor configuration to generate files",
  },
  args: {
    ...commonArgs,
    "workspace-id": {
      type: "string",
      description: "ID of the workspace to apply the configuration to",
      alias: "w",
    },
    profile: {
      type: "string",
      description: "Workspace profile to use",
      alias: "p",
    },
    config: {
      type: "string",
      description: "Path to SDK config file",
      alias: "c",
      default: "tailor.config.ts",
    },
    dryRun: {
      type: "boolean",
      description: "Run the command without making any changes",
      alias: "d",
    },
    yes: {
      type: "boolean",
      description: "Skip all confirmation prompts",
      alias: "y",
    },
  },
  run: withCommonArgs(async (args) => {
    await apply({
      workspaceId: args["workspace-id"],
      profile: args.profile,
      configPath: args.config,
      dryRun: args.dryRun,
      yes: args.yes,
    });
  }),
});
