import { logger } from "#/cli/shared/logger";
import { withSpan } from "#/cli/telemetry/index";
import { applyAIGateway, type planAIGateway } from "./aigateway";
import {
  applicationLabelLimitError,
  applyApplication,
  recomposeApplication,
  type ApplicationLabelRejection,
  type planApplication,
} from "./application";
import { applyAuth, type planAuth } from "./auth";
import { type DeploymentSource, sourceApplicationName } from "./deployment-target";
import { applyExecutor, type planExecutor } from "./executor";
import { applyFunctionRegistry, type planFunctionRegistry } from "./function-registry";
import { applyIdP, type planIdP } from "./idp";
import {
  type DeployOwner,
  type DroppedOnAppLabels,
  onAppLabelledResourceOf,
  withMetadataWriteBatch,
} from "./label";
import { MANAGED_RESOURCE_LABELS, type ManagedResourceType } from "./managed-resource-type";
import { applyPipeline, type planPipeline } from "./resolver";
import { applySecretManager, type planSecretManager } from "./secret-manager";
import { applyStaticWebsite, type planStaticWebsite } from "./staticwebsite";
import {
  applyTailorDB,
  preflightTailorDB,
  type MaintenanceModeRelease,
  type planTailorDB,
} from "./tailordb";
import {
  applyTailorDBReplication,
  type TailorDBReplicationPlanResult,
} from "./tailordb-replication";
import { applyWorkflow, type planWorkflow } from "./workflow";
import {
  applyWorkflowJobFunctionExecutionPolicy,
  type planWorkflowJobFunctionExecutionPolicy,
} from "./workflow-execution-policy";
import type { ConfigServices, EnvOverrides } from "#/cli/services/application";
import type { OperatorClient } from "#/cli/shared/client";
import type { DeployApplication } from "./deploy-application";
import type { MaintenanceReport } from "./tailordb/migration-timing";

/** How long one config's TailorDB migrations kept tables in maintenance mode. */
export interface TailorDBMaintenance extends MaintenanceReport {
  /** The application a `defineConfig()` config deploys; omitted for a workspace config. */
  application?: string;
}

export type PlannedDeployment = {
  /** The config file the deployment builds. */
  readonly source: DeploymentSource;
  /** The services the deployment's config defines. */
  readonly application: Readonly<ConfigServices>;
  /** `env` values each service uses in place of the root values with the same keys. */
  readonly envOverrides: EnvOverrides;
  /** Applications the deployment plans. */
  readonly applications: ReadonlyArray<DeployApplication>;
  /** Owner of the resources the deployment manages. */
  readonly owner: DeployOwner;
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
  readonly tailorDBReplication: TailorDBReplicationPlanResult;
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

export type PlanResults = Omit<
  PlannedDeployment,
  "source" | "application" | "envOverrides" | "applications" | "owner" | "forceApplyAll"
>;

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
  | "tailorDBReplication"
  | "staticWebsite"
  | "workflowExecutionPolicy"
  | "idp"
  | "auth";

export function deploymentPlanResults(deployment: PlannedDeployment): PlanResults {
  const {
    source: _source,
    application: _application,
    envOverrides: _envOverrides,
    applications: _applications,
    owner: _owner,
    forceApplyAll: _forceApplyAll,
    ...results
  } = deployment;
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
 * @returns The `sdk-on-app-*` labels left off resources the Platform had no room on
 */
export async function applyPrerequisiteResources(
  client: OperatorClient,
  deployments: ReadonlyArray<PlannedDeployment>,
): Promise<{ droppedOnAppLabels: OnAppLabelsDropped[] }> {
  const step = makeStep(deployments);
  const droppedOnAppLabels: OnAppLabelsDropped[] = [];
  await withMetadataWriteBatch(
    client,
    async (applyClient) => {
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
    },
    recordDroppedOnAppLabels(droppedOnAppLabels),
  );
  return { droppedOnAppLabels };
}

/** A resource the Platform had no room on for the `sdk-on-app-*` labels of these applications. */
export type OnAppLabelsDropped = {
  resourceType: ManagedResourceType;
  name: string;
  applications: string[];
};

function recordDroppedOnAppLabels(dropped: OnAppLabelsDropped[]) {
  return ({ trn, applications }: DroppedOnAppLabels) => {
    const { resourceType, name } = onAppLabelledResourceOf(trn);
    dropped.push({ resourceType, name, applications });
    logger.warn(
      `${MANAGED_RESOURCE_LABELS[resourceType]} "${name}" has no room for more labels, so it is not labelled for these applications: ${applications.join(", ")}. Remove labels that tailor does not set from it to make room.`,
    );
  };
}

type HeldMaintenanceMode = {
  deployment: PlannedDeployment;
  release: MaintenanceModeRelease;
};

/**
 * Lift every maintenance mode a TailorDB apply held, even when one fails.
 * @param client - Operator client instance
 * @param held - Maintenance modes held by the deployments' TailorDB applies
 * @param applyFailed - Whether the deploy already failed, so its error wins
 * @returns Maintenance reports produced when the held restrictions were lifted
 */
async function releaseMaintenanceModes(
  client: OperatorClient,
  held: ReadonlyArray<HeldMaintenanceMode>,
  applyFailed: boolean,
): Promise<TailorDBMaintenance[]> {
  const maintenance: TailorDBMaintenance[] = [];
  let firstError: { error: unknown } | undefined;
  for (const { deployment, release } of held) {
    try {
      const report = await release(client);
      if (report) maintenance.push(maintenanceOf(deployment, report));
    } catch (error) {
      if (!applyFailed && !firstError) {
        firstError = { error };
        continue;
      }
      logger.warn(
        `Could not lift the maintenance mode of TailorDB tables: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
  if (firstError) throw firstError.error;
  if (applyFailed) return maintenance;
  const recomposed = new Set<PlannedDeployment>();
  for (const { deployment } of held) {
    if (recomposed.has(deployment)) continue;
    recomposed.add(deployment);
    await recomposeApplication(client, deployment.app);
  }
  return maintenance;
}

/** What {@link applyRemainingResources} returns after applying the remaining resources. */
export type RemainingApplyResult = {
  /** Maintenance windows of the applications whose TailorDB migrations ran, in deploy order. */
  maintenance: TailorDBMaintenance[];
  /** Applications whose labels the platform rejected for their count. */
  labelRejections: ApplicationLabelRejection[];
  /** `sdk-on-app-*` labels left off resources the Platform had no room on. */
  droppedOnAppLabels: OnAppLabelsDropped[];
};

/**
 * Apply every resource kind not covered by {@link applyPrerequisiteResources}.
 * @param client - Operator client instance
 * @param deployments - Planned deployments to apply
 * @returns Maintenance windows and rejected application labels
 */
export async function applyRemainingResources(
  client: OperatorClient,
  deployments: ReadonlyArray<PlannedDeployment>,
): Promise<RemainingApplyResult> {
  const held: HeldMaintenanceMode[] = [];
  const labelRejections: ApplicationLabelRejection[] = [];
  const droppedOnAppLabels: OnAppLabelsDropped[] = [];
  let maintenance: TailorDBMaintenance[];
  try {
    maintenance = await applyRemainingResourcesHoldingMaintenanceMode(client, deployments, {
      held,
      labelRejections,
      droppedOnAppLabels,
    });
  } catch (error) {
    await releaseMaintenanceModes(client, held, true);
    throw error;
  }
  const released = await releaseMaintenanceModes(client, held, false);
  const order = new Map(
    deployments.map((deployment, index) => [sourceApplicationName(deployment.source), index]),
  );
  return {
    maintenance: [...maintenance, ...released].toSorted(
      (a, b) => (order.get(a.application) ?? 0) - (order.get(b.application) ?? 0),
    ),
    labelRejections,
    droppedOnAppLabels,
  };
}

function maintenanceOf(
  deployment: PlannedDeployment,
  report: MaintenanceReport,
): TailorDBMaintenance {
  const application = sourceApplicationName(deployment.source);
  return application === undefined ? report : { application, ...report };
}

type RemainingApplyOutcomes = {
  held: HeldMaintenanceMode[];
  labelRejections: ApplicationLabelRejection[];
  droppedOnAppLabels: OnAppLabelsDropped[];
};

async function applyRemainingResourcesHoldingMaintenanceMode(
  client: OperatorClient,
  deployments: ReadonlyArray<PlannedDeployment>,
  outcomes: RemainingApplyOutcomes,
): Promise<TailorDBMaintenance[]> {
  const { held, labelRejections, droppedOnAppLabels } = outcomes;
  const step = makeStep(deployments);
  const maintenance: TailorDBMaintenance[] = [];

  await withMetadataWriteBatch(
    client,
    async (applyClient) => {
      await withSpan("apply.createUpdateServices", async () => {
        await step("apply.functionRegistry.createUpdate", (d) =>
          applyFunctionRegistry(applyClient, d.functionRegistry, "create-update"),
        );
        await step("apply.tailorDBReplication.prepare", (d) =>
          applyTailorDBReplication(applyClient, d.tailorDBReplication, "prepare"),
        );
        await step("apply.tailorDB.createUpdate", async (d) => {
          const report = await applyTailorDB(applyClient, d.tailorDB, "create-update", {
            holdMaintenanceMode: (release) => held.push({ deployment: d, release }),
          });
          if (report) maintenance.push(maintenanceOf(d, report));
        });
        await step("apply.tailorDBReplication.createUpdate", (d) =>
          applyTailorDBReplication(applyClient, d.tailorDBReplication, "create-update"),
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
        await forEachDeployment(deployments, (d) =>
          applyIdP(applyClient, d.idp, "delete-resources"),
        );
      });

      await withSpan("apply.createUpdateApplication", async () => {
        await forEachDeployment(deployments, async (d) => {
          labelRejections.push(...(await applyApplication(applyClient, d.app, "create-update")));
        });
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
    },
    recordDroppedOnAppLabels(droppedOnAppLabels),
  );

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
      applyTailorDBReplication(client, d.tailorDBReplication, "delete"),
    );
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
      applyFunctionRegistry(client, d.functionRegistry, "delete"),
    );
  });
  return maintenance;
}

/**
 * Apply planned deploy changes for one or more applications in one shot:
 * {@link preflightAllTailorDB}, {@link applyPrerequisiteResources}, then
 * {@link applyRemainingResources}. `deployInternal` calls the three parts
 * separately instead, so it can rebuild between the last two when a static
 * website was just created.
 * @param client - Operator client instance
 * @param deployments - Planned deployments to apply
 */
export async function applyDeploymentPlans(
  client: OperatorClient,
  deployments: ReadonlyArray<PlannedDeployment>,
): Promise<void> {
  await preflightAllTailorDB(client, deployments);
  await applyPrerequisiteResources(client, deployments);
  const { labelRejections } = await applyRemainingResources(client, deployments);
  if (labelRejections.length > 0) throw applicationLabelLimitError(labelRejections);
}
