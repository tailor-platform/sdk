import { applyAIGateway, type planAIGateway } from "./aigateway";
import { applyApplication, type planApplication } from "./application";
import { applyAuth, type planAuth } from "./auth";
import { applyExecutor, type planExecutor } from "./executor";
import { applyFunctionRegistry, type planFunctionRegistry } from "./function-registry";
import { applyIdP, type planIdP } from "./idp";
import { applyPipeline, type planPipeline } from "./resolver";
import { applySecretManager, type planSecretManager } from "./secret-manager";
import { applyStaticWebsite, type planStaticWebsite } from "./staticwebsite";
import { applyTailorDB, type planTailorDB } from "./tailordb";
import { applyWorkflow, type planWorkflow } from "./workflow";
import type { Application } from "#/cli/services/application";
import type { OperatorClient } from "#/cli/shared/client";

export type PlannedDeployment = {
  readonly application: Readonly<Application>;
  readonly functionRegistry: Awaited<ReturnType<typeof planFunctionRegistry>>;
  readonly tailorDB: Awaited<ReturnType<typeof planTailorDB>>;
  readonly staticWebsite: Awaited<ReturnType<typeof planStaticWebsite>>;
  readonly aiGateway: Awaited<ReturnType<typeof planAIGateway>>;
  readonly idp: Awaited<ReturnType<typeof planIdP>>;
  readonly auth: Awaited<ReturnType<typeof planAuth>>;
  readonly pipeline: Awaited<ReturnType<typeof planPipeline>>;
  readonly app: Awaited<ReturnType<typeof planApplication>>;
  readonly executor: Awaited<ReturnType<typeof planExecutor>>;
  readonly workflow: Awaited<ReturnType<typeof planWorkflow>>;
  readonly secretManager: Awaited<ReturnType<typeof planSecretManager>>;
};

/**
 * Apply planned deploy changes for one or more applications.
 * @param client - Operator client instance
 * @param workspaceId - Target workspace ID
 * @param deployments - Planned deployments to apply
 */
export async function applyDeploymentPlans(
  client: OperatorClient,
  workspaceId: string,
  deployments: ReadonlyArray<PlannedDeployment>,
): Promise<void> {
  for (const deployment of deployments) {
    await applySecretManager(
      client,
      deployment.secretManager,
      "create-update",
      deployment.application,
    );
  }
  for (const deployment of deployments) {
    await applyFunctionRegistry(client, workspaceId, deployment.functionRegistry, "create-update");
  }
  for (const deployment of deployments) {
    await applyStaticWebsite(client, deployment.staticWebsite, "create-update");
  }
  for (const deployment of deployments) {
    await applyAIGateway(client, deployment.aiGateway, "create-update");
  }
  for (const deployment of deployments) {
    await applyIdP(client, deployment.idp, "create-update");
  }
  for (const deployment of deployments) {
    await applyTailorDB(client, deployment.tailorDB, "create-update");
  }
  for (const deployment of deployments) {
    await applyAuth(client, deployment.auth, "create-update");
  }
  for (const deployment of deployments) {
    await applyPipeline(client, deployment.pipeline, "create-update");
  }

  for (const deployment of deployments) {
    await applyPipeline(client, deployment.pipeline, "delete-resources");
  }
  for (const deployment of deployments) {
    await applyAuth(client, deployment.auth, "delete-resources");
  }
  for (const deployment of deployments) {
    await applyIdP(client, deployment.idp, "delete-resources");
  }

  for (const deployment of deployments) {
    await applyApplication(client, deployment.app, "create-update");
  }

  for (const deployment of deployments) {
    await applyExecutor(client, deployment.executor, "create-update");
  }
  for (const deployment of deployments) {
    await applyWorkflow(client, deployment.workflow, "create-update");
  }

  for (const deployment of deployments) {
    await applyWorkflow(client, deployment.workflow, "delete");
  }
  for (const deployment of deployments) {
    await applyExecutor(client, deployment.executor, "delete");
  }
  for (const deployment of deployments) {
    await applyStaticWebsite(client, deployment.staticWebsite, "delete");
  }
  for (const deployment of deployments) {
    await applyAIGateway(client, deployment.aiGateway, "delete");
  }
  for (const deployment of deployments) {
    await applySecretManager(client, deployment.secretManager, "delete", deployment.application);
  }

  for (const deployment of deployments) {
    await applyApplication(client, deployment.app, "delete");
  }

  for (const deployment of deployments) {
    await applyPipeline(client, deployment.pipeline, "delete-services");
  }
  for (const deployment of deployments) {
    await applyAuth(client, deployment.auth, "delete-services");
  }
  for (const deployment of deployments) {
    await applyIdP(client, deployment.idp, "delete-services");
  }
  for (const deployment of deployments) {
    await applyTailorDB(client, deployment.tailorDB, "delete-services");
  }

  for (const deployment of deployments) {
    await applyFunctionRegistry(client, workspaceId, deployment.functionRegistry, "delete");
  }
}
