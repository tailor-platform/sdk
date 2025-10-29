import { type Client } from "@connectrpc/connect";
import { type OperatorService } from "@tailor-proto/tailor/v1/service_pb";
import { defineCommand } from "citty";
import ml from "multiline-ts";
import { defineApplication } from "@/cli/application";
import { Bundler, type BundlerConfig } from "@/cli/bundler";
import { ExecutorLoader } from "@/cli/bundler/executor/loader";
import { ExecutorTransformer } from "@/cli/bundler/executor/transformer";
import { ResolverLoader } from "@/cli/bundler/pipeline/loader";
import { CodeTransformer } from "@/cli/bundler/pipeline/transformer";
import { loadConfig } from "@/cli/config-loader";
import { generateUserTypes } from "@/cli/type-generator";
import { commonArgs, withCommonArgs } from "../args";
import { fetchAll, initOperatorClient } from "../client";
import { readTailorctlConfig } from "../tailorctl";
import { applyApplication, planApplication } from "./services/application";
import { applyAuth, planAuth } from "./services/auth";
import { applyExecutor, planExecutor } from "./services/executor";
import { applyIdP, planIdP } from "./services/idp";
import { applyPipeline, planPipeline } from "./services/pipeline";
import {
  applyStaticWebsite,
  planStaticWebsite,
} from "./services/staticwebsite";
import { applyTailorDB, planTailorDB } from "./services/tailordb";
import type { AppConfig } from "@/configure/config";
import type { Executor } from "@/configure/services/executor/types";
import type { Resolver } from "@/parser/service/pipeline";

export type ApplyOptions = {
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
    for (const pipeline of app.pipelineResolverServices) {
      await buildPipeline(pipeline.namespace, pipeline.config);
    }
  }
  if (application.executorService) {
    await buildExecutor(application.executorService.config);
  }
  if (options.buildOnly) {
    return;
  }

  const tailorctlConfig = readTailorctlConfig();
  const client = await initOperatorClient(tailorctlConfig);
  const workspaceId = await fetchWorkspaceId(client, config);

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

async function fetchWorkspaceId(
  client: Client<typeof OperatorService>,
  config: Readonly<AppConfig>,
) {
  const workspaces = await fetchAll(async (pageToken) => {
    const { workspaces, nextPageToken } = await client.listWorkspaces({
      pageToken,
    });
    return [workspaces, nextPageToken];
  });

  const workspace = workspaces.find((w) => w.id === config.workspaceId);
  if (!workspace) {
    throw new Error(
      ml`
        Workspace with ID ${config.workspaceId} not found.
        Please set the correct workspaceId in the sdk config.
        `,
    );
  }
  return workspace.id;
}

async function buildPipeline(namespace: string, config: { files?: string[] }) {
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

async function buildExecutor(config: { files?: string[] }) {
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
      ["function", "job_function"].includes(executor.exec.Kind),
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
    config: {
      type: "string",
      description: "Path to the Tailor config file",
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
    await apply(configPath, args);
  }),
});
