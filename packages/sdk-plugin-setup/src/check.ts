import * as fs from "node:fs";
import {
  extractOwnedNamespaces,
  loadConfig,
  logger,
  getNamespacesWithMigrations,
} from "@tailor-platform/sdk/cli";
import * as path from "pathe";
import { isCI } from "std-env";
import { detectDefaultBranch, type GitRunner } from "./git";
import {
  AUTOFIX_LABEL,
  type LockAutofix,
  type LockTarget,
  type ManagedWorkflow,
  managedWorkflows,
  readManagedLock,
} from "./lock";
import {
  currentContentHash,
  describeHandEdit,
  describeReservedId,
  editedPartsOf,
  findReservedIds,
  isManagedHash,
  ManagedMergeError,
} from "./managed";
import { defaultLoadSeedSettings, seedSettingsProblem, type SeedSettings } from "./seed-settings";
import { TEMPLATE_VERSION } from "./templates";

const DRIFT_COUNT_MARKER = "TAILOR_SETUP_CHECK_DRIFT_COUNT";

/**
 * Stable drift rule keys. These are part of the public contract: a future
 * `ignore` input on the workflow drift-check step suppresses findings by key.
 */
type DriftRule =
  | "missing-file"
  | "hand-edit"
  | "reserved-id"
  | "template-version"
  | "config-dir"
  | "default-branch"
  | "erd-namespaces"
  | "migration-drift"
  | "seed-validate"
  | "seed";

export type DriftFinding = {
  /** Human label for the target: `<kind> <workspaceName>`. */
  target: string;
  rule: DriftRule;
  message: string;
};

/** Current state of one generated workflow file, gathered by the caller. */
type FileState = {
  fileExists: boolean;
  /**
   * Hash of the on-disk file in the scheme of the lock entry, or null when it
   * is missing, unreadable, or not valid YAML.
   */
  currentHash: string | null;
  /** Managed parts a hand edit changed, when the lock records per-part hashes. */
  editedParts?: string[];
  /** Ids of the user's jobs and steps that use the reserved `tailor-` prefix. */
  reservedIds: string[];
  /** The template version this SDK build generates. */
  templateVersion: number;
};

/** Current repository/config state for one target, gathered by the caller. */
export type TargetState = FileState & {
  /** Whether tailor.config.ts exists under the target's recorded dir. */
  configExists: boolean;
  /** Detected repository default branch, or null when it cannot be determined. */
  defaultBranch: string | null;
  /** Current owned TailorDB namespaces for ERD preview checks, or null when unavailable. */
  erdNamespaces: string[] | null;
  /** Whether the current config has TailorDB namespaces with migrations (branch/tag only). */
  hasMigrations?: boolean;
  /** Whether the current config uses the seed plugin (branch/tag only). */
  hasSeeds?: boolean;
  /** Why the current seedPlugin settings cannot seed, for a target that seeds. */
  seedProblem?: string;
  /** Current state of each app of a multi-directory target, in the order the lock records them. */
  apps?: AppState[];
};

/** Current repository state for the autofix workflow, gathered by the caller. */
export type AutofixState = FileState & {
  /** Recorded app directories that hold no tailor.config.ts anymore. */
  dirsWithoutConfig: string[];
};

/** Current config state for one app of a multi-directory target. */
export type AppState = {
  dir: string;
  configExists: boolean;
  hasMigrations?: boolean;
  hasSeeds?: boolean;
  /** Owned TailorDB namespaces, when the target previews ERDs. */
  erdNamespaces?: string[];
};

function sameNamespaces(a: readonly string[], b: readonly string[]): boolean {
  const sortedA = a.toSorted((x, y) => x.localeCompare(y));
  const sortedB = b.toSorted((x, y) => x.localeCompare(y));
  return (
    sortedA.length === sortedB.length && sortedA.every((namespace, i) => namespace === sortedB[i])
  );
}

function missingConfig(id: string, dir: string): DriftFinding {
  return {
    target: id,
    rule: "config-dir",
    message:
      `tailor.config.ts not found under "${dir}". The app directory may have moved; ` +
      "re-run setup with the correct --dir.",
  };
}

function findAppDrift(id: string, target: LockTarget, apps: readonly AppState[]): DriftFinding[] {
  const findings: DriftFinding[] = [];
  const planKind = target.kind === "branch" || target.kind === "tag";
  for (const app of apps) {
    const recorded = target.inputs.apps?.find((entry) => entry.dir === app.dir);
    if (!app.configExists) {
      findings.push(missingConfig(id, app.dir));
      continue;
    }
    if (planKind && recorded?.migrationDriftCheck === false && app.hasMigrations === true) {
      findings.push({
        target: id,
        rule: "migration-drift",
        message:
          `TailorDB namespaces with migrations were added to the config under "${app.dir}". ` +
          "Re-run setup so its tailor-migration-drift-check step is included in the plan job.",
      });
    }
    if (
      app.erdNamespaces !== undefined &&
      !sameNamespaces(recorded?.erdNamespaces ?? [], app.erdNamespaces)
    ) {
      findings.push({
        target: id,
        rule: "erd-namespaces",
        message:
          `TailorDB namespaces owned by the config under "${app.dir}" changed. ` +
          "Re-run setup so the ERD preview matrix is regenerated.",
      });
    }
    if (planKind && recorded?.seedValidate === false && app.hasSeeds === true) {
      findings.push({
        target: id,
        rule: "seed-validate",
        message:
          `Seed plugin detected in the config under "${app.dir}". ` +
          "Re-run setup so its tailor-seed-validate step is included in the plan job.",
      });
    }
  }
  return findings;
}

function findFileDrift(id: string, workflow: ManagedWorkflow, state: FileState): DriftFinding[] {
  const findings: DriftFinding[] = [];

  if (!state.fileExists) {
    findings.push({
      target: id,
      rule: "missing-file",
      message: `${workflow.file} is missing or unreadable. Re-run setup to restore it.`,
    });
  } else if (state.currentHash !== workflow.contentHash) {
    findings.push({
      target: id,
      rule: "hand-edit",
      message:
        state.currentHash === null
          ? `${workflow.file} is not valid YAML. Fix it, or re-run setup with --force to replace it.`
          : isManagedHash(workflow.contentHash)
            ? `${describeHandEdit(workflow.file, state.editedParts)} Revert them, or re-run setup ` +
              "with --force to reset them; your own jobs and steps are kept."
            : `${workflow.file} was generated by an older setup version, which compares the whole ` +
              "file, and was edited since. Re-run setup with --force once to reset only the " +
              "SDK-managed parts; your own jobs and steps are kept.",
    });
  }

  for (const reservedId of state.reservedIds) {
    findings.push({
      target: id,
      rule: "reserved-id",
      message: `${workflow.file}: ${describeReservedId(reservedId)}`,
    });
  }

  if (workflow.templateVersion < state.templateVersion) {
    findings.push({
      target: id,
      rule: "template-version",
      message:
        `A newer workflow template is available (generated with v${String(workflow.templateVersion)}, ` +
        `current v${String(state.templateVersion)}). Run \`tailor setup update\` to regenerate every target.`,
    });
  }

  return findings;
}

/**
 * Compute drift findings for one target by comparing its recorded lock state
 * against the current repository/config state.
 * @param target - The lock target being audited
 * @param state - Current repository/config state for this target
 * @returns Drift findings (empty when the target is in sync)
 */
export function findTargetDrift(target: LockTarget, state: TargetState): DriftFinding[] {
  const id = `${target.kind} ${target.workspaceName}`;
  const findings = findFileDrift(id, target, state);

  if (state.apps) {
    findings.push(...findAppDrift(id, target, state.apps));
  } else if (!state.configExists) {
    findings.push(missingConfig(id, target.inputs.dir));
  }

  if (
    target.kind !== "tag" &&
    target.inputs.branchAutoDetected !== false &&
    state.defaultBranch !== null &&
    target.inputs.branch !== null &&
    target.inputs.branch !== state.defaultBranch
  ) {
    findings.push({
      target: id,
      rule: "default-branch",
      message:
        `The workflow triggers on "${target.inputs.branch}" but the repository default branch ` +
        `is now "${state.defaultBranch}". If this is intentional, ignore this; otherwise re-run ` +
        "setup so the trigger matches the default branch.",
    });
  }

  if (target.kind === "branch" && target.inputs.erdPreview && !state.apps && state.configExists) {
    const recorded = [...(target.inputs.erdNamespaces ?? [])].toSorted((a, b) =>
      a.localeCompare(b),
    );
    const current = state.erdNamespaces?.toSorted((a, b) => a.localeCompare(b)) ?? null;
    if (
      current === null ||
      recorded.length !== current.length ||
      recorded.some((namespace, index) => namespace !== current[index])
    ) {
      findings.push({
        target: id,
        rule: "erd-namespaces",
        message:
          "TailorDB namespaces for ERD preview changed. Re-run setup so the ERD preview matrix is regenerated.",
      });
    }
  }

  if (
    (target.kind === "branch" || target.kind === "tag") &&
    target.inputs.migrationDriftCheck === false &&
    state.hasMigrations === true
  ) {
    findings.push({
      target: id,
      rule: "migration-drift",
      message:
        "TailorDB namespaces with migrations were added to the config. " +
        "Re-run setup so the tailor-migration-drift-check step is included in the plan job.",
    });
  }

  if (
    (target.kind === "branch" || target.kind === "tag") &&
    target.inputs.seedValidate === false &&
    state.hasSeeds === true
  ) {
    findings.push({
      target: id,
      rule: "seed-validate",
      message:
        "Seed plugin detected in the current config. " +
        "Re-run setup so the tailor-seed-validate step is included in the plan job.",
    });
  }

  if (target.inputs.seed !== undefined && state.seedProblem !== undefined) {
    findings.push({
      target: id,
      rule: "seed",
      message:
        `${state.seedProblem} The deploy job still seeds the workspace (tailor-seed): ` +
        "fix seedPlugin, or re-run setup without --seed.",
    });
  }

  return findings;
}

/**
 * Compute drift findings for the autofix workflow.
 * @param autofix - The lock's autofix entry
 * @param state - Current repository state for the autofix workflow
 * @returns Drift findings (empty when the workflow is in sync)
 */
export function findAutofixDrift(autofix: LockAutofix, state: AutofixState): DriftFinding[] {
  return [
    ...findFileDrift(AUTOFIX_LABEL, autofix, state),
    ...state.dirsWithoutConfig.map((dir) => missingConfig(AUTOFIX_LABEL, dir)),
  ];
}

function reservedIdsIn(workflow: ManagedWorkflow, content: string): string[] {
  try {
    return findReservedIds(content, workflow.generatedIds);
  } catch (error) {
    if (error instanceof ManagedMergeError) return [];
    throw error;
  }
}

function detectDefaultBranchSafe(cwd: string, run: GitRunner | undefined): string | null {
  try {
    return detectDefaultBranch(cwd, run);
  } catch {
    return null;
  }
}

function escapesRoot(rel: string): boolean {
  return (
    path.isAbsolute(rel) || rel === ".." || rel.startsWith(`..${path.sep}`) || rel.startsWith("../")
  );
}

// The lock is machine-owned, but a corrupted or hand-edited lock could carry an
// absolute, `..`-traversing, or symlinked path. Reject lexical escapes and, when
// the path exists, resolve symlinks and reject anything whose real location is
// outside the repo root, so the audit never reads outside it.
export function resolveWithinRoot(outputDir: string, relPath: string): string | null {
  if (path.isAbsolute(relPath)) return null;
  const abs = path.join(outputDir, relPath);
  if (escapesRoot(path.relative(outputDir, abs))) return null;
  try {
    if (escapesRoot(path.relative(fs.realpathSync(outputDir), fs.realpathSync(abs)))) return null;
  } catch {
    // The path does not exist yet; the lexical check above is sufficient and a
    // missing file is reported as drift downstream.
  }
  return abs;
}

// Treat any read failure (missing file, EISDIR, TOCTOU race, permissions) as an
// absent file so the audit reports drift instead of crashing.
function readContent(absFile: string): string | null {
  try {
    return fs.readFileSync(absFile, "utf-8");
  } catch {
    return null;
  }
}

function fileStateOf(outputDir: string, workflow: ManagedWorkflow): FileState {
  const absFile = resolveWithinRoot(outputDir, workflow.file);
  const content = absFile === null ? null : readContent(absFile);
  const currentHash = content === null ? null : currentContentHash(workflow, content);
  return {
    fileExists: content !== null,
    currentHash,
    reservedIds: content === null ? [] : reservedIdsIn(workflow, content),
    editedParts:
      content !== null && currentHash !== null && currentHash !== workflow.contentHash
        ? editedPartsOf(workflow, content)
        : undefined,
    templateVersion: TEMPLATE_VERSION,
  };
}

export type CheckGitHubOptions = {
  /** Repository root where `.github` lives. */
  outputDir: string;
  /** Injectable git runner, for testing. */
  gitRunner?: GitRunner;
  /** Injectable config-existence probe, for testing. */
  configExistsAt?: (configPath: string) => boolean;
  /** Injectable TailorDB namespace loader, for testing. Defaults to loading the config. */
  loadErdNamespaces?: (configPath: string) => Promise<string[]> | string[];
  /** Injectable migration detector, for testing. Defaults to loading the config. */
  loadHasMigrations?: (configPath: string) => Promise<boolean> | boolean;
  /** Injectable seed plugin detector, for testing. Defaults to loading the config. */
  loadHasSeeds?: (configPath: string) => Promise<boolean> | boolean;
  /** Injectable seedPlugin settings loader, for testing. Defaults to loading the config. */
  loadSeedSettings?: (configPath: string) => Promise<SeedSettings | null>;
};

async function defaultLoadErdNamespaces(configPath: string): Promise<string[]> {
  const { config } = await loadConfig(configPath);
  return extractOwnedNamespaces(config);
}

async function defaultLoadHasMigrations(configPath: string): Promise<boolean> {
  const { config } = await loadConfig(configPath);
  return getNamespacesWithMigrations(config, path.dirname(configPath)).length > 0;
}

async function defaultLoadHasSeeds(configPath: string): Promise<boolean> {
  const { plugins } = await loadConfig(configPath);
  return plugins.some((p) => p.id === "@tailor-platform/seed");
}

/**
 * Audit the generated workflows for drift against the current config/repo
 * state. Read-only: never writes files, the lock, or the config.
 *
 * Throws when drift is found (so it composes like the other `:check`
 * commands). The workflow drift-check step layers advisory behaviour on top
 * (per-rule ignore / continue-on-error); the CLI itself reports via exit code.
 * @param options - Check options
 */
export async function checkGitHub(options: CheckGitHubOptions): Promise<void> {
  const { outputDir } = options;
  const lock = readManagedLock(outputDir);

  const exists = options.configExistsAt ?? ((p: string) => fs.existsSync(p));
  const existingConfig = (dir: string): string | null => {
    const configAbs = resolveWithinRoot(outputDir, path.join(dir, "tailor.config.ts"));
    return configAbs !== null && exists(configAbs) ? configAbs : null;
  };
  const defaultBranch = detectDefaultBranchSafe(outputDir, options.gitRunner);
  const loadErdNamespaces = options.loadErdNamespaces ?? defaultLoadErdNamespaces;
  const loadHasMigrations = options.loadHasMigrations ?? defaultLoadHasMigrations;
  const loadHasSeeds = options.loadHasSeeds ?? defaultLoadHasSeeds;
  const loadSeedSettings = options.loadSeedSettings ?? defaultLoadSeedSettings;

  const findings: DriftFinding[] = [];
  for (const target of lock.targets) {
    // Multi-directory targets are audited per app below.
    const noRootConfig = target.inputs.apps !== undefined;
    const configAbs = noRootConfig ? null : existingConfig(target.inputs.dir);
    const configExists = noRootConfig || configAbs !== null;
    const erdNamespaces =
      target.kind === "branch" && target.inputs.erdPreview && configAbs !== null
        ? await loadErdNamespaces(configAbs)
        : null;
    const hasMigrations =
      (target.kind === "branch" || target.kind === "tag") &&
      target.inputs.migrationDriftCheck !== undefined &&
      configAbs !== null
        ? await loadHasMigrations(configAbs)
        : undefined;
    const hasSeeds =
      (target.kind === "branch" || target.kind === "tag") &&
      target.inputs.seedValidate !== undefined &&
      configAbs !== null
        ? await loadHasSeeds(configAbs)
        : undefined;
    const seedProblem =
      target.inputs.seed !== undefined && configAbs !== null
        ? seedSettingsProblem(target.inputs.seed.datasets, await loadSeedSettings(configAbs))
        : undefined;
    const planKind = target.kind === "branch" || target.kind === "tag";
    const apps =
      target.inputs.apps === undefined
        ? undefined
        : await Promise.all(
            target.inputs.apps.map(async (app): Promise<AppState> => {
              const appConfig = existingConfig(app.dir);
              return {
                dir: app.dir,
                configExists: appConfig !== null,
                hasMigrations:
                  planKind && appConfig !== null && app.migrationDriftCheck !== undefined
                    ? await loadHasMigrations(appConfig)
                    : undefined,
                hasSeeds:
                  planKind && appConfig !== null && app.seedValidate !== undefined
                    ? await loadHasSeeds(appConfig)
                    : undefined,
                erdNamespaces:
                  target.kind === "branch" && target.inputs.erdPreview && appConfig !== null
                    ? await loadErdNamespaces(appConfig)
                    : undefined,
              };
            }),
          );
    findings.push(
      ...findTargetDrift(target, {
        ...fileStateOf(outputDir, target),
        configExists,
        defaultBranch,
        erdNamespaces,
        hasMigrations,
        hasSeeds,
        seedProblem,
        apps,
      }),
    );
  }

  if (lock.autofix) {
    findings.push(
      ...findAutofixDrift(lock.autofix, {
        ...fileStateOf(outputDir, lock.autofix),
        dirsWithoutConfig: lock.autofix.inputs.dirs.filter((dir) => existingConfig(dir) === null),
      }),
    );
  }

  const count = managedWorkflows(lock).length;
  if (findings.length === 0) {
    logger.success(`No drift detected across ${String(count)} workflow(s).`);
    return;
  }

  for (const finding of findings) {
    logger.warn(`[${finding.target}] ${finding.message} (ignore key: ${finding.rule})`);
  }
  if (isCI) {
    logger.log(`${DRIFT_COUNT_MARKER}=${String(findings.length)}`);
  }
  throw new Error(
    `Detected ${String(findings.length)} drift finding(s) across ${String(count)} workflow(s). ` +
      "Run `tailor setup update` to regenerate, or address each finding above.",
  );
}
