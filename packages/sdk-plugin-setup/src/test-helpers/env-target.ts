import type { LockInputs, LockTarget, TargetKind } from "../lock";

/**
 * Builds a lock target that deploys through the given GitHub Environment.
 * @param kind - Target kind
 * @param workspaceName - Workspace name
 * @param environment - GitHub Environment name
 * @param inputs - Further recorded inputs, such as `splitPlanEnvironment`
 * @returns Lock target
 */
export function envTarget(
  kind: TargetKind,
  workspaceName: string,
  environment: string,
  inputs: Partial<LockInputs> = {},
): LockTarget {
  return {
    kind,
    workspaceName,
    file: `.github/workflows/tailor-${workspaceName}.yml`,
    templateVersion: 1,
    inputs: {
      branch: "main",
      tagPattern: null,
      environment,
      dir: ".",
      packageManager: "pnpm",
      ...inputs,
    },
    generatedIds: [],
    contentHash: "sha256:abc",
  };
}
