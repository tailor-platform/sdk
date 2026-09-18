import { withSpan } from "#/cli/telemetry/index";
import { applyAIGateway, type planAIGateway } from "./aigateway";
import { applyApplication, type planApplication } from "./application";
import { applyAuth, type planAuth } from "./auth";
import { applyExecutor, type planExecutor } from "./executor";
import { applyFunctionRegistry, type planFunctionRegistry } from "./function-registry";
import { applyIdP, type planIdP } from "./idp";
import { withMetadataWriteBatch } from "./label";
import { applyPipeline, type planPipeline } from "./resolver";
import { applySecretManager, type planSecretManager } from "./secret-manager";
import { applyStaticWebsite, type planStaticWebsite } from "./staticwebsite";
import { applyTailorDB, preflightTailorDB, type planTailorDB } from "./tailordb";
import { applyWorkflow, type planWorkflow } from "./workflow";
import {
  applyWorkflowJobFunctionExecutionPolicy,
  type planWorkflowJobFunctionExecutionPolicy,
} from "./workflow-execution-policy";
import type { Application } from "#/cli/services/application";
import type { OperatorClient } from "#/cli/shared/client";

export type PlannedDeployment = {
  readonly application: Readonly<Application>;
  /**
   * Whether every resource is force-reapplied because an owned resource's
   * `sdk-version` label mismatches the running SDK. Computed once per deploy
   * and reused as-is on a conditional rebuild's replan (see
   * {@link ReusablePlanKind}'s doc comment): recomputing it there could flip
   * it to `false` if the prerequisite-resource apply already refreshed the
   * one stale label that made it `true`, silently dropping a force-reapply
   * the user already confirmed.
   */
  readonly forceApplyAll: boolean;
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

export type PlanResults = Omit<PlannedDeployment, "application" | "forceApplyAll">;

/**
 * Resource kinds whose plan cannot change between a deploy's first plan and
 * the conditional rebuild `deployInternal` runs when `env` still holds an
 * unresolved static website URL: none of them embed `env` or this run's
 * rebuilt bundle content, so the rebuild reuses each one's already-confirmed
 * plan result instead of re-querying the platform and re-diffing it.
 */
export type ReusablePlanKind =
  | "tailorDB"
  | "secretManager"
  | "aiGateway"
  | "staticWebsite"
  | "workflowExecutionPolicy"
  | "idp"
  | "auth";

export function deploymentPlanResults(deployment: PlannedDeployment): PlanResults {
  const { application: _application, forceApplyAll: _forceApplyAll, ...results } = deployment;
  return results;
}

function forEachDeployment(
  deployments: ReadonlyArray<PlannedDeployment>,
  apply: (deployment: PlannedDeployment) => Promise<unknown>,
): Promise<void> {
  return (async () => {
    for (const deployment of deployments) {
      await apply(deployment);
    }
  })();
}

function makeStep(deployments: ReadonlyArray<PlannedDeployment>) {
  return (
    name: string,
    apply: (deployment: PlannedDeployment) => Promise<unknown>,
  ): Promise<void> => withSpan(name, () => forEachDeployment(deployments, apply));
}

/**
 * Validate every deployment's TailorDB migration state before anything else
 * is applied, so a stale migration checkpoint or schema fails the deploy with
 * nothing yet mutated -- instead of after prerequisite resources (secret
 * manager, static website, AI gateway, IdP, auth) are already created or
 * updated.
 * @param client - Operator client instance
 * @param deployments - Planned deployments to preflight
 */
export async function preflightAllTailorDB(
  client: OperatorClient,
  deployments: ReadonlyArray<PlannedDeployment>,
): Promise<void> {
  await withSpan("apply.preflight", async () => {
    await forEachDeployment(deployments, (d) => preflightTailorDB(client, d.tailorDB));
  });
}

/**
 * Apply the resource kinds that a static website's URL can never reference
 * (secretManager, staticWebsite, aiGateway, idp, and auth's prerequisite
 * resources): creating them first means staticWebsite's URL already exists
 * by the time the rest of the deploy -- including a rebuild triggered by
 * `deployInternal` when `env` still holds an unresolved placeholder -- runs.
 * @param client - Operator client instance
 * @param deployments - Planned deployments to apply
 */
export async function applyPrerequisiteResources(
  client: OperatorClient,
  deployments: ReadonlyArray<PlannedDeployment>,
): Promise<void> {
  const step = makeStep(deployments);
  await withMetadataWriteBatch(client, async (applyClient) => {
    await withSpan("apply.createUpdatePrerequisiteServices", async () => {
      await step("apply.secretManager.createUpdate", (d) =>
        applySecretManager(applyClient, d.secretManager, "create-update", d.application),
      );
      await step("apply.staticWebsite.createUpdate", (d) =>
        applyStaticWebsite(applyClient, d.staticWebsite, "create-update"),
      );
      await step("apply.aiGateway.createUpdate", (d) =>
        applyAIGateway(applyClient, d.aiGateway, "create-update"),
      );
      await step("apply.idp.createUpdate", (d) => applyIdP(applyClient, d.idp, "create-update"));
      await step("apply.auth.createUpdatePrerequisites", (d) =>
        applyAuth(applyClient, d.auth, "create-update-prerequisites"),
      );
    });
  });
}

/**
 * Apply every resource kind not covered by {@link applyPrerequisiteResources}.
 * @param client - Operator client instance
 * @param workspaceId - Target workspace ID
 * @param deployments - Planned deployments to apply
 */
export async function applyRemainingResources(
  client: OperatorClient,
  workspaceId: string,
  deployments: ReadonlyArray<PlannedDeployment>,
): Promise<void> {
  const step = makeStep(deployments);

  await withMetadataWriteBatch(client, async (applyClient) => {
    await withSpan("apply.createUpdateServices", async () => {
      await step("apply.functionRegistry.createUpdate", (d) =>
        applyFunctionRegistry(applyClient, workspaceId, d.functionRegistry, "create-update"),
      );
      await step("apply.tailorDB.createUpdate", (d) =>
        applyTailorDB(applyClient, d.tailorDB, "create-update"),
      );
      await step("apply.auth.createUpdateDependents", (d) =>
        applyAuth(applyClient, d.auth, "create-update-dependents"),
      );
      await step("apply.pipeline.createUpdate", (d) =>
        applyPipeline(applyClient, d.pipeline, "create-update"),
      );
    });

    await withSpan("apply.deleteSubgraphResources", async () => {
      await forEachDeployment(deployments, (d) =>
        applyPipeline(applyClient, d.pipeline, "delete-resources"),
      );
      await forEachDeployment(deployments, (d) =>
        applyAuth(applyClient, d.auth, "delete-resources"),
      );
      await forEachDeployment(deployments, (d) => applyIdP(applyClient, d.idp, "delete-resources"));
    });

    await withSpan("apply.createUpdateApplication", async () => {
      await forEachDeployment(deployments, (d) =>
        applyApplication(applyClient, d.app, "create-update"),
      );
    });

    await withSpan("apply.createUpdateDependentServices", async () => {
      await step("apply.executor.createUpdate", (d) =>
        applyExecutor(applyClient, d.executor, "create-update"),
      );
      // Execution policies must exist before workflow job functions that reference
      // them by key, otherwise the runtime rejects the dispatch as an unknown key.
      await step("apply.workflowExecutionPolicy.createUpdate", (d) =>
        applyWorkflowJobFunctionExecutionPolicy(
          applyClient,
          d.workflowExecutionPolicy,
          "create-update",
        ),
      );
      await step("apply.workflow.createUpdate", (d) =>
        applyWorkflow(applyClient, d.workflow, "create-update"),
      );
    });
  });

  await withSpan("apply.deleteDependentServices", async () => {
    await forEachDeployment(deployments, (d) => applyWorkflow(client, d.workflow, "delete"));
    await forEachDeployment(deployments, (d) =>
      applyWorkflowJobFunctionExecutionPolicy(client, d.workflowExecutionPolicy, "delete"),
    );
    await forEachDeployment(deployments, (d) => applyExecutor(client, d.executor, "delete"));
    await forEachDeployment(deployments, (d) =>
      applyStaticWebsite(client, d.staticWebsite, "delete"),
    );
    await forEachDeployment(deployments, (d) => applyAIGateway(client, d.aiGateway, "delete"));
    await forEachDeployment(deployments, (d) =>
      applySecretManager(client, d.secretManager, "delete", d.application),
    );
  });

  await withSpan("apply.deleteApplication", async () => {
    await forEachDeployment(deployments, (d) => applyApplication(client, d.app, "delete"));
  });

  await withSpan("apply.deleteSubgraphServices", async () => {
    await forEachDeployment(deployments, (d) =>
      applyPipeline(client, d.pipeline, "delete-services"),
    );
    await forEachDeployment(deployments, (d) => applyAuth(client, d.auth, "delete-services"));
    await forEachDeployment(deployments, (d) => applyIdP(client, d.idp, "delete-services"));
    await forEachDeployment(deployments, (d) =>
      applyTailorDB(client, d.tailorDB, "delete-services"),
    );
  });

  await withSpan("apply.cleanup", async () => {
    await forEachDeployment(deployments, (d) =>
      applyFunctionRegistry(client, workspaceId, d.functionRegistry, "delete"),
    );
  });
}

/**
 * Apply planned deploy changes for one or more applications in one shot:
 * {@link preflightAllTailorDB}, {@link applyPrerequisiteResources}, then
 * {@link applyRemainingResources}. `deployInternal` calls the three parts
 * separately instead, so it can rebuild between the last two when a static
 * website was just created.
 * @param client - Operator client instance
 * @param workspaceId - Target workspace ID
 * @param deployments - Planned deployments to apply
 */
export async function applyDeploymentPlans(
  client: OperatorClient,
  workspaceId: string,
  deployments: ReadonlyArray<PlannedDeployment>,
): Promise<void> {
  await preflightAllTailorDB(client, deployments);
  await applyPrerequisiteResources(client, deployments);
  await applyRemainingResources(client, workspaceId, deployments);
}
