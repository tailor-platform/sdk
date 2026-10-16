import { assertNoDuplicateResourceNames } from "./duplicate-resource-names";
import type { BuiltDeploymentTarget } from "./deployment-target";

type BundledScripts = BuiltDeploymentTarget["bundledScripts"];

const BUNDLE_KINDS: ReadonlyArray<{ key: keyof BundledScripts; resourceLabel: string }> = [
  { key: "resolvers", resourceLabel: "Resolver bundle" },
  { key: "executors", resourceLabel: "Executor bundle" },
  { key: "workflowJobs", resourceLabel: "Workflow job bundle" },
  { key: "authHooks", resourceLabel: "Auth hook bundle" },
];

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
    BUNDLE_KINDS.map(({ key, resourceLabel }) => ({
      resourceLabel,
      namesOf: (target) => target.bundledScripts[key].keys(),
    })),
  );
  const mergeKind = (key: keyof BundledScripts) =>
    new Map(targets.flatMap((target) => [...target.bundledScripts[key]]));
  return {
    resolvers: mergeKind("resolvers"),
    executors: mergeKind("executors"),
    workflowJobs: mergeKind("workflowJobs"),
    authHooks: mergeKind("authHooks"),
  };
}
