import { logger } from "@tailor-platform/sdk/cli";
import { setupAutofix, type AutofixSetupOptions } from "./autofix";
import { setupTarget, type SetupTargetOptions } from "./generate";
import {
  AUTOFIX_LABEL,
  managedWorkflows,
  readManagedLock,
  type LockAutofix,
  type LockInputs,
  type LockTarget,
} from "./lock";
import { isPackageManager, type PackageManager, type PreviewRequirement } from "./templates";

type UpdateCommon = { force: boolean; outputDir: string };

// Not `setup check`'s `!== false`: an entry without the flag may hold an explicit
// branch, and re-detecting it would silently move the deploy trigger.
function recordedBranchUnlessDetected(inputs: LockInputs): string | undefined {
  return inputs.branchAutoDetected === true ? undefined : (inputs.branch ?? undefined);
}

function recordedPackageManagerUnlessDetected(
  inputs: Pick<LockInputs, "packageManager" | "packageManagerAutoDetected">,
): PackageManager | undefined {
  if (inputs.packageManagerAutoDetected !== false) return undefined;
  if (!isPackageManager(inputs.packageManager)) {
    throw new Error(
      `.github/tailor.lock records the unsupported package manager ` +
        `${JSON.stringify(inputs.packageManager)}. Re-run its \`tailor setup ci\` subcommand ` +
        "with --package-manager.",
    );
  }
  return inputs.packageManager;
}

/**
 * Read the requirement of a preview target recorded before `require` existed: those workflows
 * always skipped drafts, and deployed only labeled PRs when `requirePreviewLabel` was set.
 * @param inputs - Inputs recorded in the lock
 * @returns The requirement that reproduces the recorded workflow, as nearly as one can
 */
function legacyPreviewRequirement(inputs: LockInputs): PreviewRequirement {
  return inputs.requirePreviewLabel ? "label" : "ready";
}

/**
 * Translate a lock entry back into the setup options that regenerate it.
 * @param target - Lock entry to regenerate
 * @param common - Options shared by every target in this update run
 * @returns The setup options to regenerate this entry with
 */
export function planUpdate(target: LockTarget, common: UpdateCommon): SetupTargetOptions {
  const { kind, workspaceName, inputs } = target;
  const dir = inputs.apps ? inputs.apps.map((app) => app.dir) : inputs.dir;
  const base = {
    workspaceName,
    dir,
    environment: inputs.environment,
    packageManager: recordedPackageManagerUnlessDetected(inputs),
    ...(inputs.seed ? { seed: inputs.seed } : {}),
    ...common,
  };

  switch (kind) {
    case "branch":
      return {
        kind,
        ...base,
        branch: recordedBranchUnlessDetected(inputs),
        extraPaths: inputs.paths,
        erdPreview: inputs.erdPreview ?? false,
        ghes: inputs.ghes ?? false,
        migrationTest: inputs.migrationTest,
        migrationTestLabel: inputs.migrationTestLabel,
        migrationTestEnvironment: inputs.migrationTestEnvironment,
        restrictDispatch: inputs.restrictDispatch ?? false,
      };
    case "tag":
      return {
        kind,
        ...base,
        tagPattern: inputs.tagPattern ?? "v*",
        branch: inputs.branch ?? undefined,
        restrictDispatch: inputs.restrictDispatch ?? false,
      };
    case "preview":
      return {
        kind,
        ...base,
        branch: recordedBranchUnlessDetected(inputs),
        extraPaths: inputs.paths,
        region: inputs.region ?? "",
        require:
          inputs.require === undefined
            ? legacyPreviewRequirement(inputs)
            : (inputs.require ?? undefined),
      };
  }
}

/**
 * Translate the lock's autofix entry back into the setup options that regenerate it.
 * @param autofix - Autofix entry to regenerate
 * @param common - Options shared by every workflow in this update run
 * @returns The setup options to regenerate the autofix workflow with
 */
function planAutofixUpdate(autofix: LockAutofix, common: UpdateCommon): AutofixSetupOptions {
  const { provider, securefixServerRepository, dirs } = autofix.inputs;
  return {
    provider,
    securefixServerRepository,
    dir: dirs,
    packageManager: recordedPackageManagerUnlessDetected(autofix.inputs),
    ...common,
  };
}

export type UpdateOptions = UpdateCommon &
  Pick<
    SetupTargetOptions,
    | "gitRunner"
    | "loadConfigId"
    | "loadErdNamespaces"
    | "loadHasMigrations"
    | "loadHasSeeds"
    | "loadSeedSettings"
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

/**
 * Regenerate every workflow recorded in `.github/tailor.lock` with the inputs it
 * was generated with. A workflow that cannot be regenerated does not stop the
 * others; all of them are reported together at the end.
 * @param options - Update options
 */
export async function setupUpdate(options: UpdateOptions): Promise<void> {
  const { force, outputDir, ...loaders } = options;
  const lock = readManagedLock(outputDir);

  const failures: string[] = [];
  for (const target of lock.targets) {
    const label = `[${target.kind} ${target.workspaceName}]`;
    try {
      await setupTarget({ ...planUpdate(target, { force, outputDir }), ...loaders });
    } catch (error) {
      failures.push(`${label} ${failureSummary(error)}`);
    }
  }
  if (lock.autofix) {
    try {
      await setupAutofix(planAutofixUpdate(lock.autofix, { force, outputDir }));
    } catch (error) {
      failures.push(`[${AUTOFIX_LABEL}] ${failureSummary(error)}`);
    }
  }

  const total = managedWorkflows(lock).length;
  const updated = total - failures.length;
  if (failures.length === 0) {
    logger.newline();
    logger.success(`Updated ${String(updated)} workflow(s). Review and commit the changes.`);
    return;
  }
  throw new Error(
    `${String(failures.length)} workflow(s) could not be updated ` +
      `(${String(updated)} of ${String(total)} updated):\n` +
      failures.map((failure) => `  ${failure.replaceAll("\n", "\n    ")}`).join("\n") +
      "\nAddress each one above, then re-run `tailor setup update`.",
  );
}
