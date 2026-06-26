import * as fs from "node:fs";
import * as path from "pathe";
import { logBetaWarning } from "#/cli/shared/beta";
import { extractOwnedNamespaces } from "#/cli/shared/config";
import { loadConfig } from "#/cli/shared/config-loader";
import { logger } from "#/cli/shared/logger";
import { detectDefaultBranch, type GitRunner } from "./git";
import { hashContent, type LockTarget, readLock } from "./lock";
import { TEMPLATE_VERSION } from "./templates";

/**
 * Stable drift rule keys. These are part of the public contract: a future
 * `ignore` input on the workflow drift-check step suppresses findings by key.
 */
export type DriftRule =
  | "missing-file"
  | "hand-edit"
  | "template-version"
  | "config-dir"
  | "default-branch"
  | "erd-namespaces";

export type DriftFinding = {
  /** Human label for the target: `<kind> <workspaceName>`. */
  target: string;
  rule: DriftRule;
  message: string;
};

/** Current repository/config state for one target, gathered by the caller. */
export type TargetState = {
  fileExists: boolean;
  /** Hash of the on-disk workflow file, or null when it is missing. */
  currentHash: string | null;
  /** Whether tailor.config.ts exists under the target's recorded dir. */
  configExists: boolean;
  /** Detected repository default branch, or null when it cannot be determined. */
  defaultBranch: string | null;
  /** The template version this SDK build generates. */
  templateVersion: number;
  /** Current owned TailorDB namespaces for ERD preview checks, or null when unavailable. */
  erdNamespaces: string[] | null;
};

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
  } else if (state.currentHash !== null && state.currentHash !== target.contentHash) {
    findings.push({
      target: id,
      rule: "hand-edit",
      message:
        `${target.file} was edited by hand since it was generated. Re-run setup with ` +
        "--force to regenerate, or keep customizations in your own jobs/steps.",
    });
  }

  if (target.templateVersion < state.templateVersion) {
    findings.push({
      target: id,
      rule: "template-version",
      message:
        `A newer workflow template is available (generated with v${String(target.templateVersion)}, ` +
        `current v${String(state.templateVersion)}). Re-run setup to update.`,
    });
  }

  if (!state.configExists) {
    findings.push({
      target: id,
      rule: "config-dir",
      message:
        `tailor.config.ts not found under "${target.inputs.dir}". The app directory may have ` +
        "moved; re-run setup with the correct --dir.",
    });
  }

  if (
    target.kind === "branch" &&
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

  if (target.kind === "branch" && target.inputs.erdPreview) {
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

  return findings;
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
function readHash(absFile: string): string | null {
  try {
    return hashContent(fs.readFileSync(absFile, "utf-8"));
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
};

async function defaultLoadErdNamespaces(configPath: string): Promise<string[]> {
  const { config } = await loadConfig(configPath);
  return extractOwnedNamespaces(config);
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
  logBetaWarning("setup");

  const { outputDir } = options;
  const lock = readLock(outputDir);
  if (!lock || lock.targets.length === 0) {
    throw new Error(
      "No managed workflows found (.github/tailor-sdk.lock is missing or empty). " +
        "Run `tailor-sdk setup` first.",
    );
  }

  const exists = options.configExistsAt ?? ((p: string) => fs.existsSync(p));
  const defaultBranch = detectDefaultBranchSafe(outputDir, options.gitRunner);
  const loadErdNamespaces = options.loadErdNamespaces ?? defaultLoadErdNamespaces;

  const findings: DriftFinding[] = [];
  for (const target of lock.targets) {
    const absFile = resolveWithinRoot(outputDir, target.file);
    const currentHash = absFile === null ? null : readHash(absFile);
    const configAbs = resolveWithinRoot(
      outputDir,
      path.join(target.inputs.dir, "tailor.config.ts"),
    );
    const configExists = configAbs !== null && exists(configAbs);
    const erdNamespaces =
      target.kind === "branch" && target.inputs.erdPreview && configAbs !== null && configExists
        ? await loadErdNamespaces(configAbs)
        : null;
    findings.push(
      ...findTargetDrift(target, {
        fileExists: currentHash !== null,
        currentHash,
        configExists,
        defaultBranch,
        templateVersion: TEMPLATE_VERSION,
        erdNamespaces,
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
  throw new Error(
    `Detected ${String(findings.length)} drift finding(s) across ${String(count)} target(s). ` +
      "Re-run `tailor-sdk setup` to regenerate, or address each finding above.",
  );
}
