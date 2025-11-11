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
import { loadAccessToken, loadWorkspaceId } from "../context";
import { applyApplication, planApplication } from "./services/application";
import { applyAuth, planAuth } from "./services/auth";
import { applyExecutor, planExecutor } from "./services/executor";
import { applyIdP, planIdP } from "./services/idp";
import { applyPipeline, planPipeline } from "./services/resolver";
import {
  applyStaticWebsite,
  planStaticWebsite,
} from "./services/staticwebsite";
import { applyTailorDB, planTailorDB } from "./services/tailordb";
import type { FileLoadConfig } from "@/cli/application/file-loader";
import type { Executor } from "@/parser/service/executor";
import type { Resolver } from "@/parser/service/resolver";

export type ApplyOptions = {
  workspaceId?: string;
  profile?: string;
  dryRun?: boolean;
  // NOTE(remiposo): Provide an option to run build-only for testing purposes.
  // This could potentially be exposed as a CLI option.
  buildOnly?: boolean;
};

export type ApplyPhase = "create-update" | "delete";

export async function apply(configPath: string, options: ApplyOptions = {}) {
  const { config } = await loadConfig(configPath);

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
  if (options.buildOnly) {
    return;
  }

  const accessToken = await loadAccessToken({
    useProfile: true,
    profile: options.profile,
  });
  const workspaceId = loadWorkspaceId({
    workspaceId: options.workspaceId,
    profile: options.profile,
  });
  const client = await initOperatorClient(accessToken);

  // Phase 1: Plan
  const tailorDB = await planTailorDB(client, workspaceId, application);
  const staticWebsite = await planStaticWebsite(
    client,
    workspaceId,
    application,
  );
  const idp = await planIdP(client, workspaceId, application);
  const auth = await planAuth(client, workspaceId, application);
  const pipeline = await planPipeline(client, workspaceId, application);
  const app = await planApplication(client, workspaceId, application);
  const executor = await planExecutor(client, workspaceId, application);
  if (options.dryRun) {
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
  },
  run: withCommonArgs(async (args) => {
    const configPath = args.config || "tailor.config.ts";
    await apply(configPath, {
      workspaceId: args["workspace-id"],
      profile: args.profile,
      dryRun: args.dryRun,
    });
  }),
});
