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
import { type LockTarget, readLock } from "./lock";
import {
  currentContentHash,
  describeHandEdit,
  describeReservedId,
  editedPartsOf,
  findReservedIds,
  isManagedHash,
  layoutOf,
  ManagedMergeError,
} from "./managed";
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
  | "static-websites";

export type DriftFinding = {
  /** Human label for the target: `<kind> <workspaceName>`. */
  target: string;
  rule: DriftRule;
  message: string;
};

/** Current repository/config state for one target, gathered by the caller. */
export type TargetState = {
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
  /** Whether tailor.config.ts exists under the target's recorded dir. */
  configExists: boolean;
  /** Detected repository default branch, or null when it cannot be determined. */
  defaultBranch: string | null;
  /** The template version this SDK build generates. */
  templateVersion: number;
  /** Current owned TailorDB namespaces for ERD preview checks, or null when unavailable. */
  erdNamespaces: string[] | null;
  /** Whether the current config has TailorDB namespaces with migrations (branch/tag only). */
  hasMigrations?: boolean;
  /** Whether the current config uses the seed plugin (branch/tag only). */
  hasSeeds?: boolean;
  /** Whether the current config has staticWebsites configured (action only). */
  hasStaticWebsites?: boolean;
  /** Current state of each app of a multi-directory target, in the order the lock records them. */
  apps?: AppState[];
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

function findAppDrift(id: string, target: LockTarget, apps: readonly AppState[]): DriftFinding[] {
  const findings: DriftFinding[] = [];
  const planKind = target.kind === "branch" || target.kind === "tag";
  for (const app of apps) {
    const recorded = target.inputs.apps?.find((entry) => entry.dir === app.dir);
    if (!app.configExists) {
      findings.push({
        target: id,
        rule: "config-dir",
        message:
          `tailor.config.ts not found under "${app.dir}". The app directory may have moved; ` +
          "re-run setup with the correct --dir.",
      });
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

/**
 * Compute drift findings for one target by comparing its recorded lock state
 * against the current repository/config state.
 * @param target - The lock target being audited
 * @param state - Current repository/config state for this target
 * @returns Drift findings (empty when the target is in sync)
 */
export function findTargetDrift(target: LockTarget, state: TargetState): DriftFinding[] {
  const id = `${target.kind} ${target.workspaceName}`;
  const findings: DriftFinding[] = [];

  if (!state.fileExists) {
    findings.push({
      target: id,
      rule: "missing-file",
      message: `${target.file} is missing or unreadable. Re-run setup to restore it.`,
    });
  } else if (state.currentHash !== target.contentHash) {
    findings.push({
      target: id,
      rule: "hand-edit",
      message:
        state.currentHash === null
          ? `${target.file} is not valid YAML. Fix it, or re-run setup with --force to replace it.`
          : isManagedHash(target.contentHash)
            ? `${describeHandEdit(target.file, state.editedParts)} Revert them, or re-run setup ` +
              "with --force to reset them; your own jobs and steps are kept."
            : `${target.file} was generated by an older setup version, which compares the whole ` +
              "file, and was edited since. Re-run setup with --force once to reset only the " +
              "SDK-managed parts; your own jobs and steps are kept.",
    });
  }

  for (const reservedId of state.reservedIds) {
    findings.push({
      target: id,
      rule: "reserved-id",
      message: `${target.file}: ${describeReservedId(reservedId)}`,
    });
  }

  if (target.templateVersion < state.templateVersion) {
    findings.push({
      target: id,
      rule: "template-version",
      message:
        `A newer workflow template is available (generated with v${String(target.templateVersion)}, ` +
        `current v${String(state.templateVersion)}). Run \`tailor setup update\` to regenerate every target.`,
    });
  }

  if (state.apps) {
    findings.push(...findAppDrift(id, target, state.apps));
  } else if (!state.configExists) {
    findings.push({
      target: id,
      rule: "config-dir",
      message:
        `tailor.config.ts not found under "${target.inputs.dir}". The app directory may have ` +
        "moved; re-run setup with the correct --dir.",
    });
  }

  if (
    (target.kind === "branch" || target.kind === "coordinate" || target.kind === "preview") &&
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

  if (
    target.kind === "action" &&
    target.inputs.hasStaticWebsites === false &&
    state.hasStaticWebsites === true
  ) {
    findings.push({
      target: id,
      rule: "static-websites",
      message:
        "Static websites were added to the config. " +
        "Re-run setup so the tailor-build-site step is included in the composite action.",
    });
  }

  return findings;
}

function reservedIdsIn(target: LockTarget, content: string): string[] {
  try {
    return findReservedIds(content, layoutOf(target.kind), target.generatedIds);
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
  /** Injectable static website detector, for testing. Defaults to loading the config. */
  loadHasStaticWebsites?: (configPath: string) => Promise<boolean> | boolean;
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

async function defaultLoadHasStaticWebsites(configPath: string): Promise<boolean> {
  const { config } = await loadConfig(configPath);
  return (config.staticWebsites?.length ?? 0) > 0;
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
  const lock = readLock(outputDir);
  if (!lock || lock.targets.length === 0) {
    throw new Error(
      "No managed workflows found (.github/tailor.lock is missing or empty). " +
        "Run `tailor setup ci branch` (or another setup subcommand) first.",
    );
  }

  const exists = options.configExistsAt ?? ((p: string) => fs.existsSync(p));
  const defaultBranch = detectDefaultBranchSafe(outputDir, options.gitRunner);
  const loadErdNamespaces = options.loadErdNamespaces ?? defaultLoadErdNamespaces;
  const loadHasMigrations = options.loadHasMigrations ?? defaultLoadHasMigrations;
  const loadHasSeeds = options.loadHasSeeds ?? defaultLoadHasSeeds;
  const loadHasStaticWebsites = options.loadHasStaticWebsites ?? defaultLoadHasStaticWebsites;

  const findings: DriftFinding[] = [];
  for (const target of lock.targets) {
    const absFile = resolveWithinRoot(outputDir, target.file);
    const content = absFile === null ? null : readContent(absFile);
    const currentHash = content === null ? null : currentContentHash(target, content);
    const reservedIds = content === null ? [] : reservedIdsIn(target, content);
    const editedParts =
      content !== null && currentHash !== null && currentHash !== target.contentHash
        ? editedPartsOf(target, content)
        : undefined;
    // Coordinator targets have no config, and multi-directory targets are audited per app below.
    const noRootConfig = target.kind === "coordinate" || target.inputs.apps !== undefined;
    const configAbs = noRootConfig
      ? null
      : resolveWithinRoot(outputDir, path.join(target.inputs.dir, "tailor.config.ts"));
    const configExists = noRootConfig || (configAbs !== null && exists(configAbs));
    const erdNamespaces =
      target.kind === "branch" && target.inputs.erdPreview && configAbs !== null && configExists
        ? await loadErdNamespaces(configAbs)
        : null;
    const hasMigrations =
      (target.kind === "branch" || target.kind === "tag") &&
      target.inputs.migrationDriftCheck !== undefined &&
      configAbs !== null &&
      configExists
        ? await loadHasMigrations(configAbs)
        : undefined;
    const hasSeeds =
      (target.kind === "branch" || target.kind === "tag") &&
      target.inputs.seedValidate !== undefined &&
      configAbs !== null &&
      configExists
        ? await loadHasSeeds(configAbs)
        : undefined;
    const hasStaticWebsites =
      target.kind === "action" &&
      target.inputs.hasStaticWebsites !== undefined &&
      configAbs !== null &&
      configExists
        ? await loadHasStaticWebsites(configAbs)
        : undefined;
    const planKind = target.kind === "branch" || target.kind === "tag";
    const apps =
      target.inputs.apps === undefined
        ? undefined
        : await Promise.all(
            target.inputs.apps.map(async (app): Promise<AppState> => {
              const appConfig = resolveWithinRoot(
                outputDir,
                path.join(app.dir, "tailor.config.ts"),
              );
              const appConfigExists = appConfig !== null && exists(appConfig);
              return {
                dir: app.dir,
                configExists: appConfigExists,
                hasMigrations:
                  planKind && appConfigExists && app.migrationDriftCheck !== undefined
                    ? await loadHasMigrations(appConfig)
                    : undefined,
                hasSeeds:
                  planKind && appConfigExists && app.seedValidate !== undefined
                    ? await loadHasSeeds(appConfig)
                    : undefined,
                erdNamespaces:
                  target.kind === "branch" && target.inputs.erdPreview && appConfigExists
                    ? await loadErdNamespaces(appConfig)
                    : undefined,
              };
            }),
          );
    findings.push(
      ...findTargetDrift(target, {
        fileExists: content !== null,
        currentHash,
        reservedIds,
        editedParts,
        configExists,
        defaultBranch,
        templateVersion: TEMPLATE_VERSION,
        erdNamespaces,
        hasMigrations,
        hasSeeds,
        hasStaticWebsites,
        apps,
      }),
    );
  }

  const count = lock.targets.length;
  if (findings.length === 0) {
    logger.success(`No drift detected across ${String(count)} target(s).`);
    return;
  }

  for (const finding of findings) {
    logger.warn(`[${finding.target}] ${finding.message} (ignore key: ${finding.rule})`);
  }
  if (isCI) {
    logger.log(`${DRIFT_COUNT_MARKER}=${String(findings.length)}`);
  }
  throw new Error(
    `Detected ${String(findings.length)} drift finding(s) across ${String(count)} target(s). ` +
      "Run `tailor setup update` to regenerate, or address each finding above.",
  );
}
