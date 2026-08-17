import { formatMigrationNumber } from "#/cli/commands/tailordb/migrate/migration-number";
import { logger, styles } from "#/cli/shared/logger";
import { deploymentPlanResults, type PlannedDeployment, type PlanResults } from "./apply-phases";
import { formatAuthHookChangeEntries } from "./auth";
import {
  formatPlanSummary,
  summarizeChangeSets,
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
import { formatResolverChangeEntries } from "./resolver";
import { formatTailorDBResourceChangeEntries } from "./tailordb";
import { formatWorkflowChangeEntries } from "./workflow";
type PrintPlanOptions = {
  dryRun?: boolean;
};

type JsonPlanPayload = {
  summary: PlanSummary;
  changes: Array<Pick<GroupedDisplayEntry, "action" | "name" | "labels" | "namespace">>;
  warnings: Array<{
    type: "unmanaged" | "skippedSecret";
    resourceType: string;
    name: string;
  }>;
  conflicts: Array<{
    resourceType: string;
    name: string;
    currentOwner: string;
  }>;
};

type PlanReport = {
  summary: PlanSummary;
  json: JsonPlanPayload;
  lines: string[];
};

function buildPlanReport(results: PlanResults): PlanReport {
  const executorEntries = formatExecutorChangeEntries(
    results.executor.changeSet,
    buildPlannedExecutorsByName(results.executor.changeSet),
    results.functionRegistry.executorFunctionChanges,
  );
  const resolverEntries = formatResolverChangeEntries(
    results.pipeline.changeSet.resolver,
    results.functionRegistry.resolverFunctionChanges,
  );
  const workflowEntries = formatWorkflowChangeEntries(
    results.workflow.changeSet,
    results.functionRegistry.workflowJobChanges,
  );
  const workflowExecutionPolicyEntries = formatChangeSetEntries(
    results.workflowExecutionPolicy.changeSet,
    ["executionPolicy"],
  );
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
  const namespaceOf = (item: HasName) => {
    if (
      "request" in item &&
      item.request &&
      typeof item.request === "object" &&
      "namespaceName" in item.request
    ) {
      return item.request.namespaceName as string;
    }
    if ("namespaceName" in item) {
      return item.namespaceName as string;
    }
    return undefined;
  };
  const authNamespaceOf = (item: HasName) =>
    "request" in item &&
    item.request &&
    typeof item.request === "object" &&
    "authNamespace" in item.request
      ? (item.request.authNamespace as string)
      : undefined;
  const idpEntries: GroupedDisplayEntry[] = [
    ...formatChangeSetEntries(results.idp.changeSet.client, ["client"], namespaceOf),
  ];
  const authEntries: GroupedDisplayEntry[] = [
    ...formatChangeSetEntries(results.auth.changeSet.idpConfig, ["idpConfig"], namespaceOf),
    ...formatChangeSetEntries(
      results.auth.changeSet.userProfileConfig,
      ["userProfileConfig"],
      namespaceOf,
    ),
    ...formatChangeSetEntries(results.auth.changeSet.tenantConfig, ["tenantConfig"], namespaceOf),
    ...formatChangeSetEntries(results.auth.changeSet.machineUser, ["machineUser"], authNamespaceOf),
    ...authHookEntries,
    ...formatChangeSetEntries(results.auth.changeSet.oauth2Client, ["oauth2Client"], namespaceOf),
    ...formatChangeSetEntries(results.auth.changeSet.scim, ["scimConfig"], namespaceOf),
    ...formatChangeSetEntries(results.auth.changeSet.scimResource, ["scimResource"], namespaceOf),
    ...formatChangeSetEntries(results.auth.changeSet.connection, ["connection"], namespaceOf),
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
    ...workflowExecutionPolicyEntries,
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

  const allUnmanaged = [
    ...results.functionRegistry.unmanaged,
    ...results.tailorDB.unmanaged,
    ...results.staticWebsite.unmanaged,
    ...results.aiGateway.unmanaged,
    ...results.idp.unmanaged,
    ...results.auth.unmanaged,
    ...results.pipeline.unmanaged,
    ...results.executor.unmanaged,
    ...results.workflow.unmanaged,
    ...results.secretManager.unmanaged,
  ];
  const allConflicts = [
    ...results.functionRegistry.conflicts,
    ...results.tailorDB.conflicts,
    ...results.staticWebsite.conflicts,
    ...results.aiGateway.conflicts,
    ...results.idp.conflicts,
    ...results.auth.conflicts,
    ...results.pipeline.conflicts,
    ...results.executor.conflicts,
    ...results.workflow.conflicts,
    ...results.secretManager.conflicts,
  ];

  const allEntries = [
    ...allDisplayEntries,
    ...tailorDBServiceActions.map(({ action, name }) => ({
      action,
      name,
      labels: ["tailorDB"],
      namespace: undefined,
    })),
    ...pipelineServiceActions.map(({ action, name }) => ({
      action,
      name,
      labels: ["pipeline"],
      namespace: undefined,
    })),
    ...idpServiceActions.map(({ action, name }) => ({
      action,
      name,
      labels: ["idp"],
      namespace: undefined,
    })),
    ...authServiceActions.map(({ action, name }) => ({
      action,
      name,
      labels: ["auth"],
      namespace: undefined,
    })),
    ...formatChangeSetEntries(otherFunctionRegistryChanges),
    ...formatChangeSetEntries(results.staticWebsite.changeSet, ["staticWebsite"]),
    ...formatChangeSetEntries(results.staticWebsite.customDomainChangeSet, ["customDomain"]),
    ...formatChangeSetEntries(results.aiGateway.changeSet, ["aiGateway"]),
    ...formatChangeSetEntries(results.app, ["application"]),
    ...formatChangeSetEntries(results.secretManager.vaultChangeSet, ["vault"]),
    ...formatChangeSetEntries(results.secretManager.secretChangeSet, ["secret"]),
  ];
  const changes = allEntries.map(({ action, name, labels, namespace }) => ({
    action,
    name,
    labels,
    namespace,
  }));
  const warnings = [
    ...allUnmanaged.map(({ resourceType, resourceName }) => ({
      type: "unmanaged" as const,
      resourceType,
      name: resourceName,
    })),
    ...results.secretManager.skippedSecrets.map((name) => ({
      type: "skippedSecret" as const,
      resourceType: "secret",
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
    ...results.staticWebsite.changeSet.lines(),
    ...results.staticWebsite.customDomainChangeSet.lines(),
    ...results.aiGateway.changeSet.lines(),
    ...results.app.lines(),
    ...buildGroupedDisplayLines("TailorDB", tailorDBEntries, tailorDBServiceActions),
    ...buildGroupedDisplayLines("Resolver", pipelineEntries, pipelineServiceActions),
    ...buildGroupedDisplayLines("Executor", executorEntries),
    ...buildGroupedDisplayLines("Workflow", workflowEntries),
    ...buildGroupedDisplayLines("IdP", idpEntries, idpServiceActions),
    ...buildGroupedDisplayLines("Auth", authEntries, authServiceActions),
    ...results.secretManager.vaultChangeSet.lines(),
    ...results.secretManager.secretChangeSet.lines(),
  ];

  if (allUnmanaged.length > 0) {
    allLines.push(styles.bold("Unmanaged resources (not in config):"));
    for (const { resourceType, resourceName } of allUnmanaged) {
      allLines.push(`  ${styles.warning("⚠")} ${styles.bold(resourceType)} "${resourceName}"`);
    }
  }

  if (results.secretManager.skippedSecrets.length > 0) {
    allLines.push(styles.bold("Secret Manager secrets (skipped - no value provided):"));
    for (const name of results.secretManager.skippedSecrets) {
      allLines.push(`  ${styles.dim("○")} ${name}`);
    }
  }

  if (allConflicts.length > 0) {
    allLines.push(styles.bold("Owner conflicts (will require confirmation on apply):"));
    for (const { resourceType, resourceName, currentOwner } of allConflicts) {
      allLines.push(
        `  ${styles.warning("!")} ${styles.bold(resourceType)} "${resourceName}" — owned by "${currentOwner}"`,
      );
    }
  }

  allLines.push(formatPlanSummary(summary));

  return {
    summary,
    json: { summary, changes, warnings, conflicts },
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
  const summary: PlanSummary = { create: 0, update: 0, delete: 0, replace: 0 };

  // Count grouped display entries
  for (const entry of displayEntries) {
    summary[entry.action] += 1;
  }

  // Count service-level actions (shown as namespace headers)
  for (const sa of serviceActions) {
    summary[sa.action] += 1;
  }

  // Count non-grouped changesets (staticWebsite, app, secretManager, functionRegistry other)
  const { otherChanges } = splitFunctionRegistryChanges(results.functionRegistry.changeSet);
  const nonGrouped = summarizeChangeSets([
    otherChanges,
    results.staticWebsite.changeSet,
    results.staticWebsite.customDomainChangeSet,
    results.aiGateway.changeSet,
    results.app,
    results.secretManager.vaultChangeSet,
    results.secretManager.secretChangeSet,
  ]);
  summary.create += nonGrouped.create;
  summary.update += nonGrouped.update;
  summary.delete += nonGrouped.delete;
  summary.replace += nonGrouped.replace;

  return summary;
}
function sumPlanSummaries(summaries: ReadonlyArray<PlanSummary>): PlanSummary {
  return summaries.reduce<PlanSummary>(
    (acc, summary) => ({
      create: acc.create + summary.create,
      update: acc.update + summary.update,
      delete: acc.delete + summary.delete,
      replace: acc.replace + summary.replace,
    }),
    { create: 0, update: 0, delete: 0, replace: 0 },
  );
}

export function printDeploymentPlans(
  deployments: ReadonlyArray<PlannedDeployment>,
  opts?: PrintPlanOptions,
): PlanSummary {
  if (logger.jsonMode && opts?.dryRun) {
    const reports = deployments.map((deployment) =>
      buildPlanReport(deploymentPlanResults(deployment)),
    );
    const summary = sumPlanSummaries(reports.map((report) => report.summary));
    logger.out({
      summary,
      changes: reports.flatMap((report) => report.json.changes),
      warnings: reports.flatMap((report) => report.json.warnings),
      conflicts: reports.flatMap((report) => report.json.conflicts),
    });
    return summary;
  }

  const summaries = deployments.map((deployment) =>
    printPlanResults(deploymentPlanResults(deployment), opts),
  );
  return sumPlanSummaries(summaries);
}
