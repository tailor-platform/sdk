import * as fs from "node:fs";
import * as path from "pathe";
import { ensureConfigId } from "@/cli/commands/deploy/config-id-injector";
import { logBetaWarning } from "@/cli/shared/beta";
import { loadConfig } from "@/cli/shared/config-loader";
import { logger, styles } from "@/cli/shared/logger";
import { detectDefaultBranch, type GitRunner } from "./git";
import {
  findTarget,
  hashContent,
  LOCK_VERSION,
  readLock,
  writeLock,
  type LockFile,
  type LockInputs,
  type LockTarget,
  type TargetKind,
} from "./lock";
import {
  detectPackageManager,
  renderBranchWorkflow,
  renderTagWorkflow,
  TEMPLATE_VERSION,
  type PackageManager,
  type RenderResult,
} from "./templates";

export type SetupGitHubOptions = {
  workspaceName?: string;
  workspaceRegion: string;
  organizationId: string;
  folderId?: string;
  branch?: string;
  tag: boolean;
  tagPattern: string;
  environment?: string;
  plan: boolean;
  dir: string;
  force: boolean;
  outputDir: string;
  /** Injectable git runner, for testing. */
  gitRunner?: GitRunner;
  /** Injectable config-name loader, for testing. Defaults to loading the config. */
  loadConfigName?: (configPath: string) => Promise<string | undefined>;
};

async function defaultLoadConfigName(configPath: string): Promise<string | undefined> {
  const { config } = await loadConfig(configPath);
  return config.name;
}

// Kept in sync with the `workspace create` schema (cli/commands/workspace/create.ts)
// so a name accepted here cannot fail workspace creation on the first deploy.
const WORKSPACE_NAME_RE = /^[a-z0-9-]+$/;

function validateWorkspaceName(name: string): void {
  if (
    name.length < 3 ||
    name.length > 63 ||
    !WORKSPACE_NAME_RE.test(name) ||
    name.startsWith("-") ||
    name.endsWith("-")
  ) {
    throw new Error(
      `Invalid workspace name "${name}". Names must be 3-63 characters of lowercase ` +
        "letters, numbers, and hyphens, and cannot start or end with a hyphen. " +
        "Pass a valid name with --workspace-name.",
    );
  }
}

/**
 * Resolve the config file path for the given app directory.
 *
 * `--dir` must stay inside the repository: the value is embedded in workflow
 * `paths:` filters and the config under it gets mutated (id injection), so
 * absolute paths and `..` traversal are rejected.
 * @param outputDir - Repository root (cwd)
 * @param dir - App directory relative to the repo root
 * @returns Absolute path to tailor.config.ts
 */
function resolveConfigPath(outputDir: string, dir: string): string {
  const appDir = path.resolve(outputDir, dir);
  const rel = path.relative(outputDir, appDir);
  if (path.isAbsolute(dir) || rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`--dir must be a relative path inside the repository (got "${dir}").`);
  }
  // Also catch symlinked subdirectories that point outside the repository.
  if (fs.existsSync(appDir)) {
    const realAppDir = path.normalize(fs.realpathSync(appDir));
    const realOutputDir = path.normalize(fs.realpathSync(outputDir));
    const realRel = path.relative(realOutputDir, realAppDir);
    if (realRel.startsWith("..") || path.isAbsolute(realRel)) {
      throw new Error(
        `--dir must resolve to a directory inside the repository (got "${dir}", which links outside it).`,
      );
    }
  }
  const configPath = path.join(appDir, "tailor.config.ts");
  if (!fs.existsSync(configPath)) {
    throw new Error(
      `tailor.config.ts not found at ${configPath}. ` +
        "Run this from your SDK project root, or pass the app directory with --dir.",
    );
  }
  return configPath;
}

type Resolved = {
  kind: TargetKind;
  workspaceName: string;
  branch: string | null;
  packageManager: PackageManager;
  render: RenderResult;
  inputs: LockInputs;
  file: string;
  configPath: string;
};

/**
 * Resolve all derived values and render the workflow content.
 * @param options - Setup options
 * @returns Resolved target metadata and rendered content
 */
async function resolve(options: SetupGitHubOptions): Promise<Resolved> {
  // Validate flag combinations up front.
  if (options.tag && !options.plan) {
    throw new Error(
      "--no-plan cannot be combined with --tag (tag targets always run plan before deploy). " +
        "Drop --no-plan or use a branch target.",
    );
  }

  const configPath = resolveConfigPath(options.outputDir, options.dir);

  const loadName = options.loadConfigName ?? defaultLoadConfigName;
  const workspaceName = options.workspaceName ?? (await loadName(configPath));
  if (!workspaceName) {
    throw new Error(
      "Could not determine the workspace name. " +
        "Pass --workspace-name, or set 'name' in tailor.config.ts.",
    );
  }
  validateWorkspaceName(workspaceName);

  const kind: TargetKind = options.tag ? "tag" : "branch";
  const workingDirectory = options.dir !== "." ? options.dir : undefined;
  const packageManager = detectPackageManager(options.outputDir);

  let branch: string | null = null;
  let render: RenderResult;
  if (kind === "branch") {
    branch = options.branch ?? detectDefaultBranch(options.outputDir, options.gitRunner);
    render = renderBranchWorkflow({
      workspaceName,
      workspaceRegion: options.workspaceRegion,
      organizationId: options.organizationId,
      folderId: options.folderId,
      branch,
      workingDirectory,
      environment: options.environment,
      packageManager,
      plan: options.plan,
    });
  } else {
    branch = options.branch ?? null;
    render = renderTagWorkflow({
      workspaceName,
      workspaceRegion: options.workspaceRegion,
      organizationId: options.organizationId,
      folderId: options.folderId,
      tagPattern: options.tagPattern,
      branch: options.branch,
      workingDirectory,
      environment: options.environment,
      packageManager,
    });
  }

  const file = `.github/workflows/tailor-${workspaceName}.yml`;
  const inputs: LockInputs = {
    workspaceRegion: options.workspaceRegion,
    organizationId: options.organizationId,
    folderId: options.folderId ?? null,
    branch,
    tagPattern: kind === "tag" ? options.tagPattern : null,
    environment: options.environment ?? null,
    dir: options.dir,
    packageManager,
    plan: kind === "branch" ? options.plan : true,
  };

  return { kind, workspaceName, branch, packageManager, render, inputs, file, configPath };
}

type Decision =
  | { action: "create" }
  | { action: "regenerate" }
  | { action: "restore" }
  | { action: "conflict"; reason: string };

/**
 * Decide how to reconcile a target with the on-disk file and lock state.
 * @param obj - Decision inputs
 * @param obj.existing - The matching lock target, if any
 * @param obj.fileExists - Whether the workflow file is present on disk
 * @param obj.currentContent - On-disk content when present
 * @param obj.force - Whether --force was passed
 * @returns The reconciliation action
 */
export function decideAction(obj: {
  existing: LockTarget | undefined;
  fileExists: boolean;
  currentContent: string | null;
  force: boolean;
}): Decision {
  const { existing, fileExists, currentContent, force } = obj;

  if (!existing) {
    if (!fileExists) return { action: "create" };
    if (force) return { action: "regenerate" };
    return {
      action: "conflict",
      reason:
        "An unmanaged workflow file already exists at this path. " +
        "Delete it, or pass --force to bring it under SDK management (this overwrites it).",
    };
  }

  // Lock has this target.
  if (!fileExists) return { action: "restore" };
  if (currentContent !== null && hashContent(currentContent) === existing.contentHash) {
    return { action: "regenerate" };
  }
  if (force) return { action: "regenerate" };
  return {
    action: "conflict",
    reason:
      "This workflow file has been edited by hand since it was generated. " +
      "Re-run with --force to discard those edits and regenerate, or revert your changes.",
  };
}

/**
 * Guard against two targets of different kinds colliding on the same file path.
 * @param obj - Conflict inputs
 * @param obj.lock - Existing lock file, or null
 * @param obj.kind - Target kind being generated
 * @param obj.workspaceName - Workspace name being generated
 * @param obj.file - Target file path
 */
function assertNoKindCollision(obj: {
  lock: LockFile | null;
  kind: TargetKind;
  workspaceName: string;
  file: string;
}): void {
  const { lock, kind, workspaceName, file } = obj;
  const collision = lock?.targets.find(
    (t) => t.file === file && !(t.kind === kind && t.workspaceName === workspaceName),
  );
  if (collision) {
    throw new Error(
      `A ${collision.kind} target already owns ${file}, which conflicts with this ${kind} target. ` +
        "Pass a different name with --workspace-name to generate a separate workflow.",
    );
  }
}

/**
 * Print next-step guidance after generating workflow files.
 * @param obj - Output context
 * @param obj.environment - GitHub Environment name, if any
 * @param obj.idInjected - Whether an app id was injected into the config
 */
function printNextSteps(obj: { environment?: string; idInjected: boolean }): void {
  const { environment, idInjected } = obj;
  const envFlag = environment ? ` --env ${environment}` : "";

  logger.newline();
  logger.info("Next steps:");
  logger.newline();
  logger.log("1. Set the machine-user credentials as GitHub secrets:");
  logger.log(`   gh secret set TAILOR_PLATFORM_MACHINE_USER_CLIENT_ID${envFlag}`);
  logger.log(`   gh secret set TAILOR_PLATFORM_MACHINE_USER_CLIENT_SECRET${envFlag}`);

  let step = 2;
  if (environment) {
    logger.newline();
    logger.log(
      `${step}. Create the "${environment}" environment under repository ` +
        "Settings > Environments and configure any required reviewers.",
    );
    step += 1;
  }

  logger.newline();
  logger.log(`${step}. Commit the generated files:`);
  logger.log("   - .github/workflows/tailor-*.yml");
  logger.log("   - .github/tailor-sdk.lock");
  if (idInjected) {
    logger.log("   - tailor.config.ts (app id was added)");
  }
}

/**
 * Generate the GitHub Actions workflow for a deploy target and reconcile it
 * with the lock file.
 * @param options - Setup options
 */
export async function setupGitHub(options: SetupGitHubOptions): Promise<void> {
  logBetaWarning("setup github");

  const resolved = await resolve(options);

  const lock = readLock(options.outputDir);
  const absFile = path.join(options.outputDir, resolved.file);

  assertNoKindCollision({
    lock,
    kind: resolved.kind,
    workspaceName: resolved.workspaceName,
    file: resolved.file,
  });

  const existing = findTarget(lock, resolved.kind, resolved.workspaceName);
  const fileExists = fs.existsSync(absFile);
  const currentContent = fileExists ? fs.readFileSync(absFile, "utf-8") : null;

  const decision = decideAction({
    existing,
    fileExists,
    currentContent,
    force: options.force,
  });

  if (decision.action === "conflict") {
    throw new Error(`${resolved.file}: ${decision.reason}`);
  }

  // Inject the app id only after reconciliation has ruled out conflicts, so
  // validation failures leave tailor.config.ts untouched (later filesystem
  // errors can still occur after injection).
  const idResult = await ensureConfigId(resolved.configPath);
  if (idResult === null) {
    logger.warn(
      "Could not find a defineConfig() call to confirm an app id. " +
        "The CI deploy will fail unless your config resolves to one with an 'id'.",
    );
  }
  const idInjected = idResult?.injected ?? false;

  fs.mkdirSync(path.dirname(absFile), { recursive: true });
  fs.writeFileSync(absFile, resolved.render.content, "utf-8");

  const newTarget: LockTarget = {
    kind: resolved.kind,
    workspaceName: resolved.workspaceName,
    file: resolved.file,
    templateVersion: TEMPLATE_VERSION,
    inputs: resolved.inputs,
    generatedIds: resolved.render.generatedIds,
    ejectedIds: existing?.ejectedIds ?? [],
    contentHash: hashContent(resolved.render.content),
  };

  // Replace in place to keep the lock diff minimal when re-running setup for
  // one of several targets.
  const targets = [...(lock?.targets ?? [])];
  const index = targets.findIndex(
    (t) => t.kind === newTarget.kind && t.workspaceName === newTarget.workspaceName,
  );
  if (index === -1) {
    targets.push(newTarget);
  } else {
    targets[index] = newTarget;
  }
  writeLock(options.outputDir, { version: LOCK_VERSION, targets });

  if (decision.action === "restore") {
    logger.success(`Restored ${styles.path(resolved.file)} from the lock`);
  } else if (decision.action === "regenerate") {
    logger.success(`Regenerated ${styles.path(resolved.file)}`);
  } else {
    logger.success(`Generated ${styles.path(resolved.file)}`);
  }

  printNextSteps({ environment: options.environment, idInjected });
}
