import { assertNoDuplicateResourceNames } from "./duplicate-resource-names";
import { MANAGED_RESOURCE_LABELS, type ManagedResourceType } from "./managed-resource-type";
import type { HttpAdapterBundleResult } from "#/cli/services/http-adapter/bundler";
import type { BuiltDeploymentTarget } from "./deployment-target";
import type { BundledScripts } from "./function-registry-types";

const BUNDLE_RESOURCE_TYPES = {
  resolvers: "pipeline.resolver",
  executors: "executor",
  workflowJobs: "workflow_job_function",
  authHooks: "auth.hook",
} satisfies Record<keyof BundledScripts, ManagedResourceType>;

const BUNDLE_KINDS = Object.keys(BUNDLE_RESOURCE_TYPES) as Array<keyof BundledScripts>;

/**
 * Merge per-config bundled scripts into one build-only result.
 * Resolver bundles are keyed by `namespace:resolverName`, so the same resolver
 * name in different namespaces never collides across configs.
 * @param targets - Built deployment targets to merge
 * @returns Combined bundled scripts across all targets
 */
export function mergeBundledScripts(targets: ReadonlyArray<BuiltDeploymentTarget>): BundledScripts {
  assertNoDuplicateResourceNames(
    targets,
    BUNDLE_KINDS.map((kind) => ({
      resourceType: BUNDLE_RESOURCE_TYPES[kind],
      resourceLabel: `${MANAGED_RESOURCE_LABELS[BUNDLE_RESOURCE_TYPES[kind]]} bundle`,
      namesOf: (target) => target.bundledScripts[kind].keys(),
    })),
  );
  const mergeKind = (kind: keyof BundledScripts) =>
    new Map(targets.flatMap((target) => [...target.bundledScripts[kind]]));
  return {
    resolvers: mergeKind("resolvers"),
    executors: mergeKind("executors"),
    workflowJobs: mergeKind("workflowJobs"),
    authHooks: mergeKind("authHooks"),
  };
}

/**
 * Collect per-config HTTP adapter bundles into one build-only result.
 * Adapter names are unique only within an application, so bundles stay
 * grouped by application name.
 * @param targets - Built deployment targets to collect from
 * @returns HTTP adapter bundles keyed by application name
 */
export function collectHttpAdapterScripts(
  targets: ReadonlyArray<BuiltDeploymentTarget>,
): Map<string, HttpAdapterBundleResult> {
  assertNoDuplicateResourceNames(targets, [
    {
      resourceType: "application",
      resourceLabel: MANAGED_RESOURCE_LABELS.application,
      namesOf: (target) => (target.httpAdapterBuildResult ? [target.application.name] : []),
    },
  ]);
  return new Map(
    targets.flatMap(({ application, httpAdapterBuildResult }) =>
      httpAdapterBuildResult ? [[application.name, httpAdapterBuildResult] as const] : [],
    ),
  );
}
