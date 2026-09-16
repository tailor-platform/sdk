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

export type PlanResults = Omit<PlannedDeployment, "application">;

export function deploymentPlanResults(deployment: PlannedDeployment): PlanResults {
  const { application: _application, ...results } = deployment;
  return results;
}

/**
 * Resource kinds whose plan and apply can be skipped on a deploy's automatic
 * repeat pass (see `deployInternal`'s static-website retry loop): none of
 * them can embed a static website's URL, and whatever they needed from this
 * run's config already went through on the first pass.
 */
export type RepeatableResourceKind =
  | "tailorDB"
  | "secretManager"
  | "aiGateway"
  | "staticWebsite"
  | "workflowExecutionPolicy";

/**
 * Apply planned deploy changes for one or more applications.
 * @param client - Operator client instance
 * @param workspaceId - Target workspace ID
 * @param deployments - Planned deployments to apply
 * @param skip - Resource kinds to leave untouched (already applied on an earlier pass)
 */
export async function applyDeploymentPlans(
  client: OperatorClient,
  workspaceId: string,
  deployments: ReadonlyArray<PlannedDeployment>,
  skip: ReadonlySet<RepeatableResourceKind> = new Set(),
): Promise<void> {
  const forEachDeployment = async (
    apply: (deployment: PlannedDeployment) => Promise<unknown>,
  ): Promise<void> => {
    for (const deployment of deployments) {
      await apply(deployment);
    }
  };

  const step = (
    name: string,
    apply: (deployment: PlannedDeployment) => Promise<unknown>,
  ): Promise<void> => withSpan(name, () => forEachDeployment(apply));

  await withSpan("apply.preflight", async () => {
    if (skip.has("tailorDB")) return;
    await forEachDeployment((d) => preflightTailorDB(client, d.tailorDB));
  });

  await withMetadataWriteBatch(client, async (applyClient) => {
    await withSpan("apply.createUpdateServices", async () => {
      if (!skip.has("secretManager")) {
        await step("apply.secretManager.createUpdate", (d) =>
          applySecretManager(applyClient, d.secretManager, "create-update", d.application),
        );
      }
      await step("apply.functionRegistry.createUpdate", (d) =>
        applyFunctionRegistry(applyClient, workspaceId, d.functionRegistry, "create-update"),
      );
      if (!skip.has("staticWebsite")) {
        await step("apply.staticWebsite.createUpdate", (d) =>
          applyStaticWebsite(applyClient, d.staticWebsite, "create-update"),
        );
      }
      if (!skip.has("aiGateway")) {
        await step("apply.aiGateway.createUpdate", (d) =>
          applyAIGateway(applyClient, d.aiGateway, "create-update"),
        );
      }
      await step("apply.idp.createUpdate", (d) => applyIdP(applyClient, d.idp, "create-update"));
      await step("apply.auth.createUpdatePrerequisites", (d) =>
        applyAuth(applyClient, d.auth, "create-update-prerequisites"),
      );
      if (!skip.has("tailorDB")) {
        await step("apply.tailorDB.createUpdate", (d) =>
          applyTailorDB(applyClient, d.tailorDB, "create-update"),
        );
      }
      await step("apply.auth.createUpdateDependents", (d) =>
        applyAuth(applyClient, d.auth, "create-update-dependents"),
      );
      await step("apply.pipeline.createUpdate", (d) =>
        applyPipeline(applyClient, d.pipeline, "create-update"),
      );
    });

    await withSpan("apply.deleteSubgraphResources", async () => {
      await forEachDeployment((d) => applyPipeline(applyClient, d.pipeline, "delete-resources"));
      await forEachDeployment((d) => applyAuth(applyClient, d.auth, "delete-resources"));
      await forEachDeployment((d) => applyIdP(applyClient, d.idp, "delete-resources"));
    });

    await withSpan("apply.createUpdateApplication", async () => {
      await forEachDeployment((d) => applyApplication(applyClient, d.app, "create-update"));
    });

    await withSpan("apply.createUpdateDependentServices", async () => {
      await step("apply.executor.createUpdate", (d) =>
        applyExecutor(applyClient, d.executor, "create-update"),
      );
      // Execution policies must exist before workflow job functions that reference
      // them by key, otherwise the runtime rejects the dispatch as an unknown key.
      if (!skip.has("workflowExecutionPolicy")) {
        await step("apply.workflowExecutionPolicy.createUpdate", (d) =>
          applyWorkflowJobFunctionExecutionPolicy(
            applyClient,
            d.workflowExecutionPolicy,
            "create-update",
          ),
        );
      }
      await step("apply.workflow.createUpdate", (d) =>
        applyWorkflow(applyClient, d.workflow, "create-update"),
      );
    });
  });

  await withSpan("apply.deleteDependentServices", async () => {
    await forEachDeployment((d) => applyWorkflow(client, d.workflow, "delete"));
    if (!skip.has("workflowExecutionPolicy")) {
      await forEachDeployment((d) =>
        applyWorkflowJobFunctionExecutionPolicy(client, d.workflowExecutionPolicy, "delete"),
      );
    }
    await forEachDeployment((d) => applyExecutor(client, d.executor, "delete"));
    if (!skip.has("staticWebsite")) {
      await forEachDeployment((d) => applyStaticWebsite(client, d.staticWebsite, "delete"));
    }
    if (!skip.has("aiGateway")) {
      await forEachDeployment((d) => applyAIGateway(client, d.aiGateway, "delete"));
    }
    if (!skip.has("secretManager")) {
      await forEachDeployment((d) =>
        applySecretManager(client, d.secretManager, "delete", d.application),
      );
    }
  });

  await withSpan("apply.deleteApplication", async () => {
    await forEachDeployment((d) => applyApplication(client, d.app, "delete"));
  });

  await withSpan("apply.deleteSubgraphServices", async () => {
    await forEachDeployment((d) => applyPipeline(client, d.pipeline, "delete-services"));
    await forEachDeployment((d) => applyAuth(client, d.auth, "delete-services"));
    await forEachDeployment((d) => applyIdP(client, d.idp, "delete-services"));
    if (!skip.has("tailorDB")) {
      await forEachDeployment((d) => applyTailorDB(client, d.tailorDB, "delete-services"));
    }
  });

  await withSpan("apply.cleanup", async () => {
    await forEachDeployment((d) =>
      applyFunctionRegistry(client, workspaceId, d.functionRegistry, "delete"),
    );
  });
}
