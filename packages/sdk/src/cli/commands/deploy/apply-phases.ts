import { driveMachine, type EffectToPerform } from "@toiroakr/chisel";
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
import {
  APPLY_DONE,
  APPLY_FLUSH,
  APPLY_RELEASE,
  APPLY_STEP_SPANS,
  applyMachine,
  applyStart,
  isBatched,
  type ApplyStage,
  type ApplyState,
  type ApplyStep,
} from "./apply-machine";
import { applyAuth, type planAuth } from "./auth";
import { type DeploymentSource, sourceApplicationName } from "./deployment-target";
import { applyExecutor, type planExecutor } from "./executor";
import { applyFunctionRegistry, type planFunctionRegistry } from "./function-registry";
import { applyIdP, type planIdP } from "./idp";
import {
  type DeployOwner,
  type DroppedOnAppLabels,
  metadataRecoveryError,
  onAppLabelledResourceOf,
  openMetadataWriteBatch,
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
  await driveApply("preflight", client, deployments, {});
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
  const droppedOnAppLabels: OnAppLabelsDropped[] = [];
  await driveApply("prerequisites", client, deployments, { droppedOnAppLabels });
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
  const outcomes: ApplyOutcomes = {
    held: [],
    maintenance: [],
    labelRejections: [],
    droppedOnAppLabels: [],
  };
  await driveApply("remaining", client, deployments, outcomes);
  const order = new Map(
    deployments.map((deployment, index) => [sourceApplicationName(deployment.source), index]),
  );
  return {
    maintenance: (outcomes.maintenance ?? []).toSorted(
      (a, b) => (order.get(a.application) ?? 0) - (order.get(b.application) ?? 0),
    ),
    labelRejections: outcomes.labelRejections ?? [],
    droppedOnAppLabels: outcomes.droppedOnAppLabels ?? [],
  };
}

function maintenanceOf(
  deployment: PlannedDeployment,
  report: MaintenanceReport,
): TailorDBMaintenance {
  const application = sourceApplicationName(deployment.source);
  return application === undefined ? report : { application, ...report };
}

type ApplyOutcomes = {
  held?: HeldMaintenanceMode[];
  maintenance?: TailorDBMaintenance[];
  labelRejections?: ApplicationLabelRejection[];
  droppedOnAppLabels?: OnAppLabelsDropped[];
};

type StepContext = {
  client: OperatorClient;
  deployment: PlannedDeployment;
  outcomes: ApplyOutcomes;
};

const APPLY_STEPS = {
  "tailorDB.preflight": ({ client, deployment }) => preflightTailorDB(client, deployment.tailorDB),
  "secretManager.create-update": ({ client, deployment }) =>
    applySecretManager(client, deployment.secretManager, "create-update", deployment.application),
  "staticWebsite.create-update": ({ client, deployment }) =>
    applyStaticWebsite(client, deployment.staticWebsite, "create-update"),
  "aiGateway.create-update": ({ client, deployment }) =>
    applyAIGateway(client, deployment.aiGateway, "create-update"),
  "idp.create-update": ({ client, deployment }) =>
    applyIdP(client, deployment.idp, "create-update"),
  "auth.create-update-prerequisites": ({ client, deployment }) =>
    applyAuth(client, deployment.auth, "create-update-prerequisites"),
  "functionRegistry.create-update": ({ client, deployment }) =>
    applyFunctionRegistry(client, deployment.functionRegistry, "create-update"),
  "tailorDBReplication.prepare": ({ client, deployment }) =>
    applyTailorDBReplication(client, deployment.tailorDBReplication, "prepare"),
  "tailorDB.create-update": async ({ client, deployment, outcomes }) => {
    const report = await applyTailorDB(client, deployment.tailorDB, "create-update", {
      holdMaintenanceMode: (release) => outcomes.held?.push({ deployment, release }),
    });
    if (report) outcomes.maintenance?.push(maintenanceOf(deployment, report));
  },
  "tailorDBReplication.create-update": ({ client, deployment }) =>
    applyTailorDBReplication(client, deployment.tailorDBReplication, "create-update"),
  "auth.create-update-dependents": ({ client, deployment }) =>
    applyAuth(client, deployment.auth, "create-update-dependents"),
  "pipeline.create-update": ({ client, deployment }) =>
    applyPipeline(client, deployment.pipeline, "create-update"),
  "pipeline.delete-resources": ({ client, deployment }) =>
    applyPipeline(client, deployment.pipeline, "delete-resources"),
  "auth.delete-resources": ({ client, deployment }) =>
    applyAuth(client, deployment.auth, "delete-resources"),
  "idp.delete-resources": ({ client, deployment }) =>
    applyIdP(client, deployment.idp, "delete-resources"),
  "app.create-update": async ({ client, deployment, outcomes }) => {
    outcomes.labelRejections?.push(
      ...(await applyApplication(client, deployment.app, "create-update")),
    );
  },
  "executor.create-update": ({ client, deployment }) =>
    applyExecutor(client, deployment.executor, "create-update"),
  "workflowExecutionPolicy.create-update": ({ client, deployment }) =>
    applyWorkflowJobFunctionExecutionPolicy(
      client,
      deployment.workflowExecutionPolicy,
      "create-update",
    ),
  "workflow.create-update": ({ client, deployment }) =>
    applyWorkflow(client, deployment.workflow, "create-update"),
  "workflow.delete": ({ client, deployment }) =>
    applyWorkflow(client, deployment.workflow, "delete"),
  "workflowExecutionPolicy.delete": ({ client, deployment }) =>
    applyWorkflowJobFunctionExecutionPolicy(client, deployment.workflowExecutionPolicy, "delete"),
  "executor.delete": ({ client, deployment }) =>
    applyExecutor(client, deployment.executor, "delete"),
  "staticWebsite.delete": ({ client, deployment }) =>
    applyStaticWebsite(client, deployment.staticWebsite, "delete"),
  "aiGateway.delete": ({ client, deployment }) =>
    applyAIGateway(client, deployment.aiGateway, "delete"),
  "tailorDBReplication.delete": ({ client, deployment }) =>
    applyTailorDBReplication(client, deployment.tailorDBReplication, "delete"),
  "secretManager.delete": ({ client, deployment }) =>
    applySecretManager(client, deployment.secretManager, "delete", deployment.application),
  "app.delete": ({ client, deployment }) => applyApplication(client, deployment.app, "delete"),
  "pipeline.delete-services": ({ client, deployment }) =>
    applyPipeline(client, deployment.pipeline, "delete-services"),
  "auth.delete-services": ({ client, deployment }) =>
    applyAuth(client, deployment.auth, "delete-services"),
  "idp.delete-services": ({ client, deployment }) =>
    applyIdP(client, deployment.idp, "delete-services"),
  "tailorDB.delete-services": ({ client, deployment }) =>
    applyTailorDB(client, deployment.tailorDB, "delete-services"),
  "functionRegistry.delete": ({ client, deployment }) =>
    applyFunctionRegistry(client, deployment.functionRegistry, "delete"),
} satisfies Record<ApplyStep, (context: StepContext) => Promise<unknown>>;

function isApplyStep(name: string): name is ApplyStep {
  return Object.hasOwn(APPLY_STEPS, name);
}

/**
 * Run one apply stage as `applyMachine` orders it: each effect the machine names is performed here,
 * and a failure goes wherever the machine says, so the metadata queued so far is written and the
 * maintenance modes held so far are lifted before the first failure is thrown.
 * @param stage - Stage to run
 * @param client - Operator client instance
 * @param deployments - Planned deployments to apply
 * @param outcomes - Collects what the stage's applies report
 */
async function driveApply(
  stage: ApplyStage,
  client: OperatorClient,
  deployments: ReadonlyArray<PlannedDeployment>,
  outcomes: ApplyOutcomes,
): Promise<void> {
  const batch = openMetadataWriteBatch(
    client,
    outcomes.droppedOnAppLabels && recordDroppedOnAppLabels(outcomes.droppedOnAppLabels),
  );
  let failure: { error: unknown } | undefined;
  const perform = async (effect: EffectToPerform<ApplyState, "next">): Promise<void> => {
    if (effect.name === APPLY_FLUSH) {
      try {
        await batch.flush();
      } catch (flushError) {
        throw failure ? metadataRecoveryError(failure.error, flushError) : flushError;
      }
      return;
    }
    if (effect.name === APPLY_RELEASE) {
      const applyFailed = effect.before.failed;
      outcomes.maintenance?.push(
        ...(await releaseMaintenanceModes(client, outcomes.held ?? [], applyFailed)),
      );
      return;
    }
    if (!isApplyStep(effect.name)) throw new TypeError(`Unknown apply step ${effect.name}`);
    const apply = APPLY_STEPS[effect.name];
    const span = APPLY_STEP_SPANS.get(effect.name);
    const stepClient = isBatched(effect.before) ? batch.client : client;
    const run = () =>
      forEachDeployment(deployments, (deployment) =>
        apply({ client: stepClient, deployment, outcomes }),
      );
    await (span === undefined ? run() : withSpan(span, run));
  };
  let state: ApplyState = applyStart(stage);
  while (state.phase !== APPLY_DONE) {
    const phase = state.phase;
    let failed: { error: unknown } | undefined;
    const drive = async () => {
      const result = await driveMachine(applyMachine, state, "next", { perform });
      state = result.state;
      const [first] = result.failures;
      if (!first) return;
      failed = { error: first.error };
      if (first.name === APPLY_FLUSH && failure) failure = failed;
      else failure ??= failed;
      throw first.error;
    };
    try {
      await (phase.startsWith("apply.") ? withSpan(phase, drive) : drive());
    } catch (error) {
      if (!failed || failed.error !== error) throw error;
    }
  }
  if (failure) throw failure.error;
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
