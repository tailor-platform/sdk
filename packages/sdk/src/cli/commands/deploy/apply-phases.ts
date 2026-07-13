import { withSpan } from "#/cli/telemetry/index";
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
import {
  applyWorkflowJobFunctionExecutionPolicy,
  type planWorkflowJobFunctionExecutionPolicy,
} from "./workflow-execution-policy";
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
  readonly workflowExecutionPolicy: Awaited<
    ReturnType<typeof planWorkflowJobFunctionExecutionPolicy>
  >;
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
  const forEachDeployment = async (
    apply: (deployment: PlannedDeployment) => Promise<unknown>,
  ): Promise<void> => {
    for (const deployment of deployments) {
      await apply(deployment);
    }
  };

  await withSpan("apply.createUpdateServices", async () => {
    await forEachDeployment((d) =>
      applySecretManager(client, d.secretManager, "create-update", d.application),
    );
    await forEachDeployment((d) =>
      applyFunctionRegistry(client, workspaceId, d.functionRegistry, "create-update"),
    );
    await forEachDeployment((d) => applyStaticWebsite(client, d.staticWebsite, "create-update"));
    await forEachDeployment((d) => applyAIGateway(client, d.aiGateway, "create-update"));
    await forEachDeployment((d) => applyIdP(client, d.idp, "create-update"));
    await forEachDeployment((d) => applyAuth(client, d.auth, "create-update-prerequisites"));
    await forEachDeployment((d) => applyTailorDB(client, d.tailorDB, "create-update"));
    await forEachDeployment((d) => applyAuth(client, d.auth, "create-update-dependents"));
    await forEachDeployment((d) => applyPipeline(client, d.pipeline, "create-update"));
  });

  await withSpan("apply.deleteSubgraphResources", async () => {
    await forEachDeployment((d) => applyPipeline(client, d.pipeline, "delete-resources"));
    await forEachDeployment((d) => applyAuth(client, d.auth, "delete-resources"));
    await forEachDeployment((d) => applyIdP(client, d.idp, "delete-resources"));
  });

  await withSpan("apply.createUpdateApplication", async () => {
    await forEachDeployment((d) => applyApplication(client, d.app, "create-update"));
  });

  await withSpan("apply.createUpdateDependentServices", async () => {
    await forEachDeployment((d) => applyExecutor(client, d.executor, "create-update"));
    // Execution policies must exist before workflow job functions that reference
    // them by key, otherwise the runtime rejects the dispatch as an unknown key.
    await forEachDeployment((d) =>
      applyWorkflowJobFunctionExecutionPolicy(client, d.workflowExecutionPolicy, "create-update"),
    );
    await forEachDeployment((d) => applyWorkflow(client, d.workflow, "create-update"));
  });

  await withSpan("apply.deleteDependentServices", async () => {
    await forEachDeployment((d) => applyWorkflow(client, d.workflow, "delete"));
    await forEachDeployment((d) =>
      applyWorkflowJobFunctionExecutionPolicy(client, d.workflowExecutionPolicy, "delete"),
    );
    await forEachDeployment((d) => applyExecutor(client, d.executor, "delete"));
    await forEachDeployment((d) => applyStaticWebsite(client, d.staticWebsite, "delete"));
    await forEachDeployment((d) => applyAIGateway(client, d.aiGateway, "delete"));
    await forEachDeployment((d) =>
      applySecretManager(client, d.secretManager, "delete", d.application),
    );
  });

  await withSpan("apply.deleteApplication", async () => {
    await forEachDeployment((d) => applyApplication(client, d.app, "delete"));
  });

  await withSpan("apply.deleteSubgraphServices", async () => {
    await forEachDeployment((d) => applyPipeline(client, d.pipeline, "delete-services"));
    await forEachDeployment((d) => applyAuth(client, d.auth, "delete-services"));
    await forEachDeployment((d) => applyIdP(client, d.idp, "delete-services"));
    await forEachDeployment((d) => applyTailorDB(client, d.tailorDB, "delete-services"));
  });

  await withSpan("apply.cleanup", async () => {
    await forEachDeployment((d) =>
      applyFunctionRegistry(client, workspaceId, d.functionRegistry, "delete"),
    );
  });
}
