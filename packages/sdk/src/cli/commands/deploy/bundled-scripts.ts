import { resolverFunctionName } from "./function-registry";
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

function collectDuplicateBundleNames(
  targets: ReadonlyArray<BuiltDeploymentTarget>,
  select: (target: BuiltDeploymentTarget) => ReadonlyMap<string, string>,
): ReadonlySet<string> {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const target of targets) {
    for (const name of select(target).keys()) {
      if (seen.has(name)) {
        duplicates.add(name);
      }
      seen.add(name);
    }
  }
  return duplicates;
}

function addResolverBundledScripts(
  target: Map<string, string>,
  source: BuiltDeploymentTarget,
  duplicateNames: ReadonlySet<string>,
): void {
  const consumedNames = new Set<string>();
  for (const service of source.application.resolverServices) {
    for (const resolver of Object.values(service.resolvers)) {
      const code = source.bundledScripts.resolvers.get(resolver.name);
      if (code === undefined) {
        continue;
      }
      const name = duplicateNames.has(resolver.name)
        ? resolverFunctionName(service.namespace, resolver.name)
        : resolver.name;
      setBundledScript(target, name, code, "resolver");
      consumedNames.add(resolver.name);
    }
  }
  for (const [name, code] of source.bundledScripts.resolvers) {
    if (!consumedNames.has(name)) {
      setBundledScript(target, name, code, "resolver");
    }
  }
}

/**
 * Merge per-config bundled scripts into one build-only result.
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
  const duplicateResolverNames = collectDuplicateBundleNames(
    targets,
    (target) => target.bundledScripts.resolvers,
  );

  for (const target of targets) {
    addResolverBundledScripts(bundledScripts.resolvers, target, duplicateResolverNames);
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
