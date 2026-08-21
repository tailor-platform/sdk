import type { BuiltDeploymentTarget } from "./deployment-target";

function setBundledScript(
  target: Map<string, string>,
  name: string,
  code: string,
  kind: string,
): void {
  if (target.has(name)) {
    throw new Error(`Duplicate ${kind} bundle name "${name}" across config files.`);
  }
  target.set(name, code);
}

function addBundledScripts(
  target: Map<string, string>,
  source: ReadonlyMap<string, string>,
  kind: string,
): void {
  for (const [name, code] of source) {
    setBundledScript(target, name, code, kind);
  }
}

/**
 * Merge per-config bundled scripts into one build-only result.
 * Resolver bundles are keyed by `namespace:resolverName`, so the same resolver
 * name in different namespaces never collides across configs.
 * @param targets - Built deployment targets to merge
 * @returns Combined bundled scripts across all targets
 */
export function mergeBundledScripts(
  targets: ReadonlyArray<BuiltDeploymentTarget>,
): BuiltDeploymentTarget["bundledScripts"] {
  const bundledScripts: BuiltDeploymentTarget["bundledScripts"] = {
    resolvers: new Map(),
    executors: new Map(),
    workflowJobs: new Map(),
    authHooks: new Map(),
  };

  for (const target of targets) {
    addBundledScripts(bundledScripts.resolvers, target.bundledScripts.resolvers, "resolver");
    addBundledScripts(bundledScripts.executors, target.bundledScripts.executors, "executor");
    addBundledScripts(
      bundledScripts.workflowJobs,
      target.bundledScripts.workflowJobs,
      "workflow job",
    );
    addBundledScripts(bundledScripts.authHooks, target.bundledScripts.authHooks, "auth hook");
  }

  return bundledScripts;
}
