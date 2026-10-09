import { logger } from "@tailor-platform/sdk/cli";
import {
  setupCoordinate,
  setupTarget,
  type CoordinateSetupOptions,
  type SetupTargetOptions,
} from "./generate";
import { readLock, type LockInputs, type LockTarget, type TargetKind } from "./lock";

type UpdateCommon = { force: boolean; outputDir: string };

type UpdatePlan =
  | { kind: "target"; options: SetupTargetOptions }
  | { kind: "coordinate"; options: CoordinateSetupOptions }
  | { kind: "skip"; reason: string };

// Not `setup check`'s `!== false`: an entry without the flag may hold an explicit
// branch, and re-detecting it would silently move the deploy trigger.
function recordedBranchUnlessDetected(inputs: LockInputs): string | undefined {
  return inputs.branchAutoDetected === true ? undefined : (inputs.branch ?? undefined);
}

/**
 * Translate a lock entry back into the setup options that regenerate it.
 * @param target - Lock entry to regenerate
 * @param common - Options shared by every target in this update run
 * @returns The setup call to make for this entry, or why it cannot be regenerated
 */
export function planUpdate(target: LockTarget, common: UpdateCommon): UpdatePlan {
  const { kind, workspaceName, inputs } = target;
  const dir = inputs.apps ? inputs.apps.map((app) => app.dir) : inputs.dir;
  const base = { workspaceName, dir, environment: inputs.environment, ...common };

  switch (kind) {
    case "branch":
      return {
        kind: "target",
        options: {
          kind,
          ...base,
          branch: recordedBranchUnlessDetected(inputs),
          extraPaths: inputs.paths,
          erdPreview: inputs.erdPreview ?? false,
          migrationTest: inputs.migrationTest,
          migrationTestLabel: inputs.migrationTestLabel,
          migrationTestEnvironment: inputs.migrationTestEnvironment,
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
          extraPaths: inputs.paths,
          region: inputs.region ?? "",
          requirePreviewLabel: inputs.requirePreviewLabel ?? false,
        },
      };
    case "action":
      return { kind: "target", options: { kind, ...base } };
    case "coordinate": {
      const coordinateKind = inputs.tagPattern !== null ? "tag" : "branch";
      const branch =
        coordinateKind === "tag"
          ? (inputs.branch ?? undefined)
          : recordedBranchUnlessDetected(inputs);
      if (!inputs.actionGroups) {
        const flags = [
          `--name ${workspaceName}`,
          coordinateKind === "tag" ? "--tag" : null,
          branch !== undefined ? `--branch ${branch}` : null,
          inputs.environment !== workspaceName ? `--environment ${inputs.environment}` : null,
          inputs.restrictDispatch ? "--restrict-dispatch" : null,
        ].filter((flag) => flag !== null);
        return {
          kind: "skip",
          reason:
            "This coordinator was generated before its --action grouping was recorded, so it " +
            "cannot be regenerated from the lock. Re-run it once by hand with its original " +
            `groups (\`tailor setup ci coordinate ${flags.join(" ")} --action <a,b> --action <c> ...\`); ` +
            "later updates pick the grouping up from the lock.",
        };
      }
      return {
        kind: "coordinate",
        options: {
          coordinatorName: workspaceName,
          coordinateKind,
          actions: inputs.actionGroups.map((group) => group.join(",")),
          branch,
          tagPattern: inputs.tagPattern ?? undefined,
          environment: inputs.environment,
          restrictDispatch: inputs.restrictDispatch ?? false,
          ...common,
        },
      };
    }
  }
}

export type UpdateOptions = UpdateCommon &
  Pick<
    SetupTargetOptions,
    | "gitRunner"
    | "loadConfigId"
    | "loadErdNamespaces"
    | "loadHasMigrations"
    | "loadHasSeeds"
    | "loadHasStaticWebsites"
  >;

// Not the SDK's errorSummary: it is not exported from @tailor-platform/sdk/cli,
// and importing it would make this plugin require a newer SDK.
function failureSummary(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const { details, suggestion } = error as { details?: unknown; suggestion?: unknown };
  const labelled = (label: string, value: unknown) =>
    typeof value === "string" && value.length > 0 ? [`${label}: ${value}`] : [];
  return [
    error.message,
    ...labelled("Details", details),
    ...labelled("Suggestion", suggestion),
  ].join("\n");
}

// Grouped coordinators refuse action entries from an older template, so the
// actions they read must be regenerated first.
const KIND_ORDER: Record<TargetKind, number> = {
  action: 0,
  branch: 1,
  tag: 1,
  preview: 1,
  coordinate: 2,
};

/**
 * Regenerate every target recorded in `.github/tailor.lock` with the inputs it
 * was generated with. A target that cannot be regenerated does not stop the
 * others; all of them are reported together at the end.
 * @param options - Update options
 */
export async function setupUpdate(options: UpdateOptions): Promise<void> {
  const { force, outputDir, ...loaders } = options;
  const lock = readLock(outputDir);
  if (!lock || lock.targets.length === 0) {
    throw new Error(
      "No managed workflows found (.github/tailor.lock is missing or empty). " +
        "Run `tailor setup ci branch` (or another setup subcommand) first.",
    );
  }

  const targets = lock.targets.toSorted((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);
  const failures: string[] = [];
  for (const target of targets) {
    const label = `[${target.kind} ${target.workspaceName}]`;
    const plan = planUpdate(target, { force, outputDir });
    try {
      if (plan.kind === "skip") {
        failures.push(`${label} ${plan.reason}`);
      } else if (plan.kind === "coordinate") {
        await setupCoordinate({ ...plan.options, gitRunner: loaders.gitRunner });
      } else {
        await setupTarget({ ...plan.options, ...loaders });
      }
    } catch (error) {
      failures.push(`${label} ${failureSummary(error)}`);
    }
  }

  const updated = targets.length - failures.length;
  if (failures.length === 0) {
    logger.newline();
    logger.success(`Updated ${String(updated)} target(s). Review and commit the changes.`);
    return;
  }
  throw new Error(
    `${String(failures.length)} target(s) could not be updated ` +
      `(${String(updated)} of ${String(targets.length)} updated):\n` +
      failures.map((failure) => `  ${failure.replaceAll("\n", "\n    ")}`).join("\n") +
      "\nAddress each one above, then re-run `tailor setup update`.",
  );
}
