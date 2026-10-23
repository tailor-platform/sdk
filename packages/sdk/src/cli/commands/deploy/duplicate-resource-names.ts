import * as path from "pathe";
import { CLIError } from "#/cli/shared/errors";
import type { BuiltDeploymentTarget } from "./deployment-target";

type DuplicateResourceName = {
  resourceType: string;
  name: string;
  configPaths: string[];
};

export type ResourceNameCheck = {
  resourceType: string;
  resourceLabel: string;
  namesOf: (target: BuiltDeploymentTarget) => Iterable<string>;
};

function findDuplicateResourceNames(
  targets: ReadonlyArray<BuiltDeploymentTarget>,
  checks: ReadonlyArray<ResourceNameCheck>,
): Array<DuplicateResourceName & { resourceLabel: string }> {
  return checks.flatMap(({ resourceType, resourceLabel, namesOf }) => {
    const configPathsByName = new Map<string, string[]>();
    for (const target of targets) {
      for (const name of namesOf(target)) {
        const configPaths = configPathsByName.get(name);
        if (configPaths) {
          configPaths.push(target.config.path);
        } else {
          configPathsByName.set(name, [target.config.path]);
        }
      }
    }
    return [...configPathsByName]
      .filter(([, configPaths]) => configPaths.length > 1)
      .map(([name, configPaths]) => ({
        resourceType,
        resourceLabel,
        name,
        configPaths: [...new Set(configPaths)],
      }));
  });
}

/**
 * Reject names defined more than once across the deploy's configs, reporting
 * every duplicate of every checked resource type in a single error.
 * @param targets - Built deployment targets to check
 * @param checks - Resource types to check, in reporting order
 */
export function assertNoDuplicateResourceNames(
  targets: ReadonlyArray<BuiltDeploymentTarget>,
  checks: ReadonlyArray<ResourceNameCheck>,
): void {
  const duplicates = findDuplicateResourceNames(targets, checks);
  if (duplicates.length === 0) {
    return;
  }
  const hasServiceNamespaceAcrossConfigs = duplicates.some(
    ({ resourceType, configPaths }) => resourceType.endsWith(".service") && configPaths.length > 1,
  );
  throw CLIError({
    code: "DEPLOY_DUPLICATE_RESOURCE_NAME",
    message: [
      "Duplicate resource names in this deploy:",
      ...duplicates.map(
        ({ resourceLabel, name, configPaths }) =>
          `  - ${resourceLabel} "${name}": ${configPaths
            .map((configPath) => path.relative(process.cwd(), configPath))
            .join(", ")}`,
      ),
    ].join("\n"),
    suggestion: [
      "Rename the duplicates so each name is defined once across all configs in a single deploy.",
      ...(hasServiceNamespaceAcrossConfigs
        ? [
            "To share a service namespace across configs, define it in one config and declare it with `attach: true` in the others.",
          ]
        : []),
    ].join(" "),
    context: {
      duplicates: duplicates.map(({ resourceType, name, configPaths }): DuplicateResourceName => ({
        resourceType,
        name,
        configPaths,
      })),
    },
  });
}
