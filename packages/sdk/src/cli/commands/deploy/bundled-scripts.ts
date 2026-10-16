import { assertNoDuplicateResourceNames } from "./duplicate-resource-names";
import type { BuiltDeploymentTarget } from "./deployment-target";
import type { BundledScripts } from "./function-registry-types";

const BUNDLE_RESOURCE_LABELS = {
  resolvers: "Resolver bundle",
  executors: "Executor bundle",
  workflowJobs: "Workflow job bundle",
  authHooks: "Auth hook bundle",
} satisfies Record<keyof BundledScripts, string>;

const BUNDLE_KINDS = Object.keys(BUNDLE_RESOURCE_LABELS) as Array<keyof BundledScripts>;

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
      resourceLabel: BUNDLE_RESOURCE_LABELS[kind],
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
