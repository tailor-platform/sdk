import type { CoordinateSetupOptions, SetupTargetOptions } from "./generate";
import type { LockInputs, LockTarget } from "./lock";

type UpdateCommon = { force: boolean; outputDir: string };

type UpdatePlan =
  | { kind: "target"; options: SetupTargetOptions }
  | { kind: "coordinate"; options: CoordinateSetupOptions }
  | { kind: "skip"; reason: string };

// Mirrors `setup check`'s default-branch rule: only an explicit `false` pins the branch.
function recordedBranchUnlessDetected(inputs: LockInputs): string | undefined {
  return inputs.branchAutoDetected === false ? (inputs.branch ?? undefined) : undefined;
}

/**
 * Translate a lock entry back into the setup options that regenerate it.
 * @param target - Lock entry to regenerate
 * @param common - Options shared by every target in this update run
 * @returns The setup call to make for this entry, or why it cannot be regenerated
 */
export function planUpdate(target: LockTarget, common: UpdateCommon): UpdatePlan {
  const { kind, workspaceName, inputs } = target;
  const base = { workspaceName, dir: inputs.dir, environment: inputs.environment, ...common };

  switch (kind) {
    case "branch":
      return {
        kind: "target",
        options: {
          kind,
          ...base,
          branch: recordedBranchUnlessDetected(inputs),
          erdPreview: inputs.erdPreview ?? false,
          restrictDispatch: inputs.restrictDispatch ?? false,
        },
      };
    case "tag":
      return {
        kind: "target",
        options: {
          kind,
          ...base,
          tagPattern: inputs.tagPattern ?? "v*",
          branch: inputs.branch ?? undefined,
          restrictDispatch: inputs.restrictDispatch ?? false,
        },
      };
    case "preview":
      return {
        kind: "target",
        options: {
          kind,
          ...base,
          branch: recordedBranchUnlessDetected(inputs),
          region: inputs.region ?? "",
          requirePreviewLabel: inputs.requirePreviewLabel ?? false,
        },
      };
    case "action":
      return { kind: "target", options: { kind, ...base } };
    case "coordinate": {
      if (!inputs.actionGroups) {
        return {
          kind: "skip",
          reason:
            "This coordinator was generated before its --action grouping was recorded, so it " +
            "cannot be regenerated from the lock. Re-run it once by hand with the same groups " +
            `(\`tailor setup ci coordinate --name ${workspaceName} --action <a,b> --action <c> ...\`); ` +
            "later updates pick the grouping up from the lock.",
        };
      }
      const coordinateKind = inputs.tagPattern !== null ? "tag" : "branch";
      return {
        kind: "coordinate",
        options: {
          coordinatorName: workspaceName,
          coordinateKind,
          actions: inputs.actionGroups.map((group) => group.join(",")),
          branch:
            coordinateKind === "tag"
              ? (inputs.branch ?? undefined)
              : recordedBranchUnlessDetected(inputs),
          tagPattern: inputs.tagPattern ?? undefined,
          environment: inputs.environment,
          restrictDispatch: inputs.restrictDispatch ?? false,
          ...common,
        },
      };
    }
  }
}
