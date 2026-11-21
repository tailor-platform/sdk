import { formatMigrationNumber } from "#/cli/commands/tailordb/migrate/migration-number";
import { logger, styles } from "#/cli/shared/logger";
import { deploymentPlanResults, type PlannedDeployment, type PlanResults } from "./apply-phases";
import { formatAuthHookChangeEntries } from "./auth";
import {
  formatPlanSummary,
  summarizeChangeSets,
  type ChangeSet,
  type HasName,
  type PlanSummary,
} from "./change-set";
import { buildPlannedExecutorsByName, formatExecutorChangeEntries } from "./executor";
import { splitFunctionRegistryChanges } from "./function-registry";
import {
  ACTION_SYMBOLS,
  buildGroupedDisplayLines,
  extractServiceActions,
  formatChangeSetEntries,
  type GroupedDisplayEntry,
  type NamespaceAction,
} from "./grouped-display";
import {
  collectOwnerConflicts,
  collectTakeovers,
  collectUnmanagedResources,
  countLabelRefreshes,
  MANAGED_RESOURCES,
} from "./managed-resources";
import { formatResolverChangeEntries } from "./resolver";
import { formatTailorDBResourceChangeEntries } from "./tailordb";
import { formatWorkflowChangeEntries } from "./workflow";
import type { MissingDependentApp, WorkspaceTakeover } from "./confirm";
import type { ManagedResourceType } from "./managed-resource-type";
import type { CustomDomainNoteKind } from "./staticwebsite";
type PrintPlanOptions = {
  dryRun?: boolean;
};

/** Deploy hook that a dry run would run after applying resources. */
interface PendingDeployedHook {
  /** The application a `defineConfig()` config deploys; omitted for a workspace config. */
  application?: string;
  pluginId: string;
}

export type PrintDeploymentPlansOptions = PrintPlanOptions & {
  pendingDeployedHooks?: readonly PendingDeployedHook[];
  /** Applications recorded as dependencies but absent from this deploy. */
  missingDependentApps?: readonly MissingDependentApp[];
};

type JsonPlanPayload = {
  summary: PlanSummary;
  changes: Array<
    Pick<GroupedDisplayEntry, "action" | "name" | "labels" | "namespace" | "forcedBySdkVersion">
  >;
  warnings: Array<{
    type: "unmanaged" | "skippedSecret";
    resourceType: ManagedResourceType;
    name: string;
  }>;
  conflicts: Array<{
    resourceType: ManagedResourceType;
    name: string;
    currentOwner: string;
  }>;
  /** Resources an application config deployed that a workspace config takes over or deletes. */
  takeovers?: Array<{
    resourceType: ManagedResourceType;
    name: string;
    action: WorkspaceTakeover["action"];
    currentOwner?: string;
  }>;
  /** Custom domains that produced no change, with the reason. */
  notes: Array<{
    type: CustomDomainNoteKind;
    resourceType: ManagedResourceType;
    name: string;
    message: string;
  }>;
};

type MissingDependentAppWarning = Pick<
  MissingDependentApp,
  "resourceType" | "namespace" | "name" | "appId" | "reason"
> & {
  type: "missingDependentApp";
  /** Set only on the records about a workflow's jobs. */
  scope?: "jobs";
};

type JsonDeploymentPlansPayload = Omit<JsonPlanPayload, "warnings"> & {
  warnings: Array<JsonPlanPayload["warnings"][number] | MissingDependentAppWarning>;
  pendingDeployedHooks?: readonly PendingDeployedHook[];
};

type PlanReport = {
  summary: PlanSummary;
  json: JsonPlanPayload;
  lines: string[];
};

type PlainChangeSet = {
  changeSet: Pick<
    ChangeSet<HasName, HasName, HasName, HasName>,
    "creates" | "updates" | "deletes" | "replaces" | "lines"
  >;
  label: string;
};

/**
 * List the change sets the plan reports without grouping them by service.
 * @param results - Planned results across all services
 * @returns Change sets the text plan lists before and after the grouped sections
 */
function plainChangeSetsOf(results: PlanResults): {
  beforeGroups: PlainChangeSet[];
  afterGroups: PlainChangeSet[];
} {
  return {
    beforeGroups: [
      { changeSet: results.staticWebsite.changeSet, label: "staticWebsite" },
      { changeSet: results.staticWebsite.customDomainChangeSet, label: "customDomain" },
      {
        changeSet: results.staticWebsite.customDomainTransferChangeSet,
        label: "customDomainTransfer",
      },
      { changeSet: results.aiGateway.changeSet, label: "aiGateway" },
      { changeSet: results.app, label: "application" },
    ],
    afterGroups: [
      { changeSet: results.secretManager.vaultChangeSet, label: "vault" },
      { changeSet: results.secretManager.secretChangeSet, label: "secret" },
    ],
  };
}

function buildPlanReport(results: PlanResults): PlanReport {
  const plainChangeSets = plainChangeSetsOf(results);
  const namespacedEntries = (
    resourceType: Exclude<ManagedResourceType, "workflow_job_function">,
    label: string,
  ) => {
    const resource = MANAGED_RESOURCES[resourceType];
    return formatChangeSetEntries(resource.changeSetOf(results), [label], (item) =>
      resource.namespace?.of(item),
    );
  };
  const executorEntries = formatExecutorChangeEntries(
    results.executor.changeSet,
    buildPlannedExecutorsByName(results.executor.changeSet),
    results.functionRegistry.executorFunctionChanges,
  );
  const resolverEntries = formatResolverChangeEntries(
    results.pipeline.changeSet.resolver,
    results.functionRegistry.resolverFunctionChanges,
  );
  const workflowResourceEntries = formatWorkflowChangeEntries(
    results.workflow.changeSet,
    results.functionRegistry.workflowJobChanges,
    results.workflow.jobFunctionDeletes,
  );
  const workflowExecutionPolicyEntries = formatChangeSetEntries(
    results.workflowExecutionPolicy.changeSet,
    ["executionPolicy"],
  );
  const workflowEntries: GroupedDisplayEntry[] = [
    ...workflowResourceEntries,
    ...workflowExecutionPolicyEntries,
  ];
  const authHookEntries = formatAuthHookChangeEntries(
    results.auth.changeSet.authHook,
    results.functionRegistry.authHookFunctionChanges,
  );
  const tailorDBResourceEntries = formatTailorDBResourceChangeEntries(
    results.tailorDB.changeSet.type,
    results.tailorDB.changeSet.gqlPermission,
  );
  const checkpointRepairEntries: GroupedDisplayEntry[] =
    results.tailorDB.context.checkpointRepairs.map((repair) => ({
      action: "update",
      symbol: ACTION_SYMBOLS.update,
      name: `migration checkpoint ${formatMigrationNumber(repair.from)} → ${formatMigrationNumber(repair.to)}`,
      labels: ["migrationCheckpoint"],
      namespace: repair.namespace,
    }));
  const tailorDBEntries: GroupedDisplayEntry[] = [
    ...tailorDBResourceEntries,
    ...checkpointRepairEntries,
  ];
  const pipelineEntries: GroupedDisplayEntry[] = [...resolverEntries];
  const idpEntries: GroupedDisplayEntry[] = [...namespacedEntries("idp.client", "client")];
  const authEntries: GroupedDisplayEntry[] = [
    ...namespacedEntries("auth.idp_config", "idpConfig"),
    ...namespacedEntries("auth.user_profile_config", "userProfileConfig"),
    ...namespacedEntries("auth.tenant_config", "tenantConfig"),
    ...namespacedEntries("auth.machine_user", "machineUser"),
    ...authHookEntries,
    ...namespacedEntries("auth.oauth2_client", "oauth2Client"),
    ...namespacedEntries("auth.scim", "scimConfig"),
    ...namespacedEntries("auth.scim_resource", "scimResource"),
    ...formatChangeSetEntries(results.auth.changeSet.connection, ["connection"]),
  ];

  const { otherChanges: otherFunctionRegistryChanges } = splitFunctionRegistryChanges(
    results.functionRegistry.changeSet,
  );
  const tailorDBServiceActions = extractServiceActions(results.tailorDB.changeSet.service);
  const pipelineServiceActions = extractServiceActions(results.pipeline.changeSet.service);
  const idpServiceActions = extractServiceActions(results.idp.changeSet.service);
  const authServiceActions = extractServiceActions(results.auth.changeSet.service);

  const allDisplayEntries = [
    ...tailorDBEntries,
    ...pipelineEntries,
    ...executorEntries,
    ...workflowEntries,
    ...idpEntries,
    ...authEntries,
  ];
  const allServiceActions = [
    ...tailorDBServiceActions,
    ...pipelineServiceActions,
    ...idpServiceActions,
    ...authServiceActions,
  ];
  const summary = summarizePlanResults(results, allDisplayEntries, allServiceActions);

  const allUnmanaged = collectUnmanagedResources(results);
  const allConflicts = collectOwnerConflicts(results);
  const allTakeovers = collectTakeovers(results);

  const serviceEntries = (serviceActions: ReadonlyArray<NamespaceAction>, label: string) =>
    serviceActions.map((serviceAction) => ({
      ...serviceAction,
      labels: [label],
      namespace: undefined,
    }));
  const allEntries = [
    ...allDisplayEntries,
    ...serviceEntries(tailorDBServiceActions, "tailorDB"),
    ...serviceEntries(pipelineServiceActions, "pipeline"),
    ...serviceEntries(idpServiceActions, "idp"),
    ...serviceEntries(authServiceActions, "auth"),
    ...formatChangeSetEntries(otherFunctionRegistryChanges),
    ...[...plainChangeSets.beforeGroups, ...plainChangeSets.afterGroups].flatMap(
      ({ changeSet, label }) => formatChangeSetEntries(changeSet, [label]),
    ),
  ];
  const changes = allEntries.map(({ action, name, labels, namespace, forcedBySdkVersion }) => ({
    action,
    name,
    labels,
    namespace,
    ...(forcedBySdkVersion && { forcedBySdkVersion }),
  }));
  const warnings = [
    ...allUnmanaged.map(({ resourceType, resourceName }) => ({
      type: "unmanaged" as const,
      resourceType,
      name: resourceName,
    })),
    ...results.secretManager.skippedSecrets.map((name) => ({
      type: "skippedSecret" as const,
      resourceType: "secret.secret" as const,
      name,
    })),
  ];
  const conflicts = allConflicts.map(({ resourceType, resourceName, currentOwner }) => ({
    resourceType,
    name: resourceName,
    currentOwner,
  }));

  const allLines: string[] = [
    ...buildGroupedDisplayLines(
      results.functionRegistry.changeSet.title,
      formatChangeSetEntries(otherFunctionRegistryChanges),
    ),
    ...plainChangeSets.beforeGroups.flatMap(({ changeSet }) => changeSet.lines()),
    ...buildGroupedDisplayLines("TailorDB", tailorDBEntries, tailorDBServiceActions),
    ...buildGroupedDisplayLines("Resolver", pipelineEntries, pipelineServiceActions),
    ...buildGroupedDisplayLines("Executor", executorEntries),
    ...buildGroupedDisplayLines("Workflow", workflowEntries),
    ...buildGroupedDisplayLines("IdP", idpEntries, idpServiceActions),
    ...buildGroupedDisplayLines("Auth", authEntries, authServiceActions),
    ...plainChangeSets.afterGroups.flatMap(({ changeSet }) => changeSet.lines()),
  ];

  if (allUnmanaged.length > 0) {
    allLines.push(styles.bold("Unmanaged resources (not in config):"));
    for (const { resourceLabel, resourceName } of allUnmanaged) {
      allLines.push(`  ${styles.warning("⚠")} ${styles.bold(resourceLabel)} "${resourceName}"`);
    }
  }

  if (results.secretManager.skippedSecrets.length > 0) {
    allLines.push(styles.bold("Secret Manager secrets (skipped - no value provided):"));
    for (const name of results.secretManager.skippedSecrets) {
      allLines.push(`  ${styles.dim("○")} ${name}`);
    }
  }

  const customDomainNotes = results.staticWebsite.customDomainNotes;
  if (customDomainNotes.length > 0) {
    allLines.push(styles.bold("Custom domains (no change):"));
    for (const note of customDomainNotes) {
      allLines.push(`  ${styles.dim("\u25cb")} ${note.domain} \u2014 ${note.message}`);
    }
  }

  if (allTakeovers.length > 0) {
    allLines.push(
      styles.bold("Taken over from application configs (will require confirmation on apply):"),
    );
    for (const { resourceLabel, resourceName, action, currentOwner } of allTakeovers) {
      const outcome =
        action === "delete"
          ? `deleted${currentOwner ? ` (deployed by "${currentOwner}")` : ""}`
          : `taken over${currentOwner ? ` from "${currentOwner}"` : ""}`;
      allLines.push(
        `  ${styles.warning("!")} ${styles.bold(resourceLabel)} "${resourceName}" — ${outcome}`,
      );
    }
  }

  if (allConflicts.length > 0) {
    allLines.push(styles.bold("Owner conflicts (will require confirmation on apply):"));
    for (const { resourceLabel, resourceName, currentOwner } of allConflicts) {
      allLines.push(
        `  ${styles.warning("!")} ${styles.bold(resourceLabel)} "${resourceName}" — owned by "${currentOwner}"`,
      );
    }
  }

  allLines.push(formatPlanSummary(summary));

  const notes = customDomainNotes.map((note) => ({
    type: note.kind,
    resourceType: "staticwebsite.custom_domain_transfer" as const,
    name: note.domain,
    message: note.message,
  }));

  return {
    summary,
    json: {
      summary,
      changes,
      warnings,
      conflicts,
      ...(allTakeovers.length > 0 && {
        takeovers: allTakeovers.map(({ resourceType, resourceName, action, currentOwner }) => ({
          resourceType,
          name: resourceName,
          action,
          ...(currentOwner && { currentOwner }),
        })),
      }),
      notes,
    },
    lines: allLines,
  };
}

/**
 * Format and output the plan results, then return a summary of change counts.
 * In JSON dry-run mode a JSON payload is written to stdout. In all other modes
 * the human-readable diff goes to stdout (dry-run) or stderr (apply).
 * @param results - Planned results across all services
 * @param opts - Output options (dry-run mode flag)
 * @returns Aggregated plan summary counts
 */
export function printPlanResults(results: PlanResults, opts?: PrintPlanOptions): PlanSummary {
  const report = buildPlanReport(results);

  if (logger.jsonMode && opts?.dryRun) {
    logger.out(report.json);
    return report.summary;
  }

  const output = report.lines.join("\n");
  if (opts?.dryRun) {
    logger.out(output);
  } else {
    logger.log(output);
  }

  return report.summary;
}

/**
 * Summarize plan counts from display entries, service actions, and non-grouped changesets.
 * @param results - Planned apply results
 * @param displayEntries - All grouped display entries across sections
 * @param serviceActions - All service-level namespace actions
 * @returns Aggregated plan summary
 */
export function summarizePlanResults(
  results: PlanResults,
  displayEntries: ReadonlyArray<GroupedDisplayEntry>,
  serviceActions: ReadonlyArray<NamespaceAction>,
): PlanSummary {
  const summary: PlanSummary = {
    create: 0,
    update: 0,
    delete: 0,
    replace: 0,
    forcedBySdkVersion: 0,
    labelRefreshes: countLabelRefreshes(results),
  };

  // Count grouped display entries and service-level actions (shown as namespace headers)
  for (const entry of [...displayEntries, ...serviceActions]) {
    summary[entry.action] += 1;
    if (entry.forcedBySdkVersion) {
      summary.forcedBySdkVersion += 1;
    }
  }

  const { otherChanges } = splitFunctionRegistryChanges(results.functionRegistry.changeSet);
  const { beforeGroups, afterGroups } = plainChangeSetsOf(results);
  const nonGrouped = summarizeChangeSets([
    otherChanges,
    ...[...beforeGroups, ...afterGroups].map(({ changeSet }) => changeSet),
  ]);

  return sumPlanSummaries([summary, nonGrouped]);
}
function sumPlanSummaries(summaries: ReadonlyArray<PlanSummary>): PlanSummary {
  return summaries.reduce<PlanSummary>(
    (acc, summary) => ({
      create: acc.create + summary.create,
      update: acc.update + summary.update,
      delete: acc.delete + summary.delete,
      replace: acc.replace + summary.replace,
      forcedBySdkVersion: acc.forcedBySdkVersion + summary.forcedBySdkVersion,
      labelRefreshes: acc.labelRefreshes + summary.labelRefreshes,
    }),
    { create: 0, update: 0, delete: 0, replace: 0, forcedBySdkVersion: 0, labelRefreshes: 0 },
  );
}

export function printDeploymentPlans(
  deployments: ReadonlyArray<PlannedDeployment>,
  opts?: PrintDeploymentPlansOptions,
): PlanSummary {
  if (logger.jsonMode && opts?.dryRun) {
    const reports = deployments.map((deployment) =>
      buildPlanReport(deploymentPlanResults(deployment)),
    );
    const summary = sumPlanSummaries(reports.map((report) => report.summary));
    logger.out({
      summary,
      changes: reports.flatMap((report) => report.json.changes),
      warnings: [
        ...reports.flatMap((report) => report.json.warnings),
        ...(opts.missingDependentApps ?? []).map(
          ({
            resourceType,
            namespace,
            name,
            scope,
            appId,
            reason,
          }): MissingDependentAppWarning => ({
            type: "missingDependentApp",
            resourceType,
            namespace,
            name,
            ...(scope === "jobs" && { scope }),
            appId,
            reason,
          }),
        ),
      ],
      conflicts: reports.flatMap((report) => report.json.conflicts),
      ...(reports.some((report) => report.json.takeovers) && {
        takeovers: reports.flatMap((report) => report.json.takeovers ?? []),
      }),
      notes: reports.flatMap((report) => report.json.notes),
      ...(opts.pendingDeployedHooks?.length
        ? { pendingDeployedHooks: opts.pendingDeployedHooks }
        : {}),
    } satisfies JsonDeploymentPlansPayload);
    return summary;
  }

  const summaries = deployments.map((deployment) =>
    printPlanResults(deploymentPlanResults(deployment), opts),
  );
  return sumPlanSummaries(summaries);
}
