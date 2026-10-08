import { logger } from "@tailor-platform/sdk/cli";
import { setupTarget, type SetupTargetOptions } from "./generate";
import { readLock, type LockInputs, type LockTarget } from "./lock";

type UpdateCommon = { force: boolean; outputDir: string };

// Not `setup check`'s `!== false`: an entry without the flag may hold an explicit
// branch, and re-detecting it would silently move the deploy trigger.
function recordedBranchUnlessDetected(inputs: LockInputs): string | undefined {
  return inputs.branchAutoDetected === true ? undefined : (inputs.branch ?? undefined);
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
  const base = { workspaceName, dir, environment: inputs.environment, ...common };

  switch (kind) {
    case "branch":
      return {
        kind,
        ...base,
        branch: recordedBranchUnlessDetected(inputs),
        extraPaths: inputs.paths,
        erdPreview: inputs.erdPreview ?? false,
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
        requirePreviewLabel: inputs.requirePreviewLabel ?? false,
      };
  }
}

export type UpdateOptions = UpdateCommon &
  Pick<
    SetupTargetOptions,
    "gitRunner" | "loadConfigId" | "loadErdNamespaces" | "loadHasMigrations" | "loadHasSeeds"
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

  const { targets } = lock;
  const failures: string[] = [];
  for (const target of targets) {
    const label = `[${target.kind} ${target.workspaceName}]`;
    try {
      await setupTarget({ ...planUpdate(target, { force, outputDir }), ...loaders });
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
