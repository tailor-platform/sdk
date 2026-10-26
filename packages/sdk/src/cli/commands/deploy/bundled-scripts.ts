import { assertNoDuplicateResourceNames, type ResourceNameCheck } from "./duplicate-resource-names";
import type { HttpAdapterBundleResult } from "#/cli/services/http-adapter/bundler";
import type { BuiltDeploymentTarget } from "./deployment-target";
import type { BundledScripts } from "./function-registry-types";

const BUNDLE_RESOURCES = {
  resolvers: { resourceType: "pipeline.resolver", resourceLabel: "Resolver bundle" },
  executors: { resourceType: "executor", resourceLabel: "Executor bundle" },
  workflowJobs: { resourceType: "workflow_job_function", resourceLabel: "Workflow job bundle" },
  authHooks: { resourceType: "auth.hook", resourceLabel: "Auth hook bundle" },
} satisfies Record<keyof BundledScripts, Omit<ResourceNameCheck, "namesOf">>;

const BUNDLE_KINDS = Object.keys(BUNDLE_RESOURCES) as Array<keyof BundledScripts>;

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
      ...BUNDLE_RESOURCES[kind],
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
      resourceLabel: "Application",
      namesOf: (target) => (target.httpAdapterBuildResult ? [target.application.name] : []),
    },
  ]);
  return new Map(
    targets.flatMap(({ application, httpAdapterBuildResult }) =>
      httpAdapterBuildResult ? [[application.name, httpAdapterBuildResult] as const] : [],
    ),
  );
}
