import * as fs from "node:fs";
import { logger } from "@tailor-platform/sdk/cli";
import * as path from "pathe";
import { agentRequirements } from "./env";
import {
  assertDistinctAppSlugs,
  decideAction,
  logWritten,
  normalizeDir,
  reconcileContent,
  resolveConfigPath,
  resolvePackageManager,
} from "./generate";
import { LOCK_VERSION, readLock, writeLock } from "./lock";
import {
  AGENT_BOT,
  AUTOFIX_WORKFLOW_FILE,
  codemodLockfiles,
  isAutofixAgent,
  LOCKFILES,
  renderAutofixWorkflow,
  TEMPLATE_VERSION,
  type AutofixCodemod,
  type AutofixCodemodParams,
  type AutofixProvider,
  type AutofixProviderParams,
  type CopilotAuth,
  type PackageManager,
} from "./templates";

export type AutofixSetupOptions = {
  provider: AutofixProvider;
  /** For the `securefix` provider: the repository that runs the securefix server workflow. */
  securefixServerRepository?: string;
  /** What the workflow does with the codemods of an SDK upgrade; none when undefined. */
  codemod: AutofixCodemod | undefined;
  /** For `--codemod copilot`: how the agent authenticates (default `pat`). */
  copilotAuth?: CopilotAuth;
  /** App directory, or several; `tailor generate` runs in each. */
  dir: string | readonly string[];
  /** Package manager the workflow uses; detected from the repository root when omitted. */
  packageManager?: PackageManager;
  force: boolean;
  outputDir: string;
};

export type AutofixSetupResult = AutofixCodemodParams & {
  provider: AutofixProvider;
};

// GitHub repository names; the value is embedded into workflow YAML as a plain scalar.
const REPOSITORY_NAME_RE = /^[A-Za-z0-9._-]+$/;

function resolveProvider(options: AutofixSetupOptions): AutofixProviderParams {
  const { provider, securefixServerRepository: name } = options;
  if (provider !== "securefix") {
    if (name !== undefined) {
      throw new Error("--securefix-server-repository is only used with --provider securefix.");
    }
    return { provider };
  }
  if (name === undefined) {
    throw new Error(
      "--provider securefix requires --securefix-server-repository: the name of the repository " +
        "that runs the securefix server workflow.",
    );
  }
  if (!REPOSITORY_NAME_RE.test(name) || name === "." || name === "..") {
    throw new Error(
      `Invalid --securefix-server-repository "${name}". Pass the repository name without its ` +
        'owner, using letters, numbers, ".", "_", and "-".',
    );
  }
  return { provider, securefixServerRepository: name };
}

function resolveCodemod(options: AutofixSetupOptions): AutofixCodemodParams {
  const { codemod, copilotAuth } = options;
  if (codemod === "copilot") return { codemod, copilotAuth: copilotAuth ?? "pat" };
  if (copilotAuth !== undefined) {
    throw new Error("--copilot-auth is only used with --codemod copilot.");
  }
  return { codemod };
}

function assertCodemodLockfile(outputDir: string, packageManager: PackageManager): void {
  const exists = (file: string) => fs.existsSync(path.join(outputDir, file));
  const readable = codemodLockfiles(packageManager);
  const unreadable = LOCKFILES.find(
    ([file, manager]) => manager === packageManager && !readable.includes(file) && exists(file),
  );
  if (unreadable && !readable.some(exists)) {
    throw new Error(
      `--codemod reads the SDK version of the base branch from ${readable.join(" or ")}, but the ` +
        `repository root has only ${unreadable[0]}. Switch to bun.lock with ` +
        "`bun install --save-text-lockfile`, then re-run.",
    );
  }
}

/**
 * Generate the workflow that commits what `tailor generate` changes to the pull request, and
 * record it in the lock file.
 * @param options - Setup options
 * @returns What was generated, for {@link printAutofixNextSteps}
 */
export async function setupAutofix(options: AutofixSetupOptions): Promise<AutofixSetupResult> {
  const { provider, codemod, outputDir, force } = options;
  const dirs = (typeof options.dir === "string" ? [options.dir] : options.dir).map(normalizeDir);
  assertDistinctAppSlugs(dirs);
  for (const dir of dirs) resolveConfigPath(outputDir, dir);
  const providerParams = resolveProvider(options);
  const codemodParams = resolveCodemod(options);
  const packageManager = resolvePackageManager(outputDir, options.packageManager);
  if (codemod) assertCodemodLockfile(outputDir, packageManager);
  const render = renderAutofixWorkflow({
    ...providerParams,
    ...codemodParams,
    dirs,
    packageManager,
  });

  const lock = readLock(outputDir);
  const owner = lock?.targets.find((target) => target.file === AUTOFIX_WORKFLOW_FILE);
  if (owner) {
    throw new Error(
      `The ${owner.kind} target "${owner.workspaceName}" already owns ${AUTOFIX_WORKFLOW_FILE}. ` +
        "Regenerate that target under another --name and delete this file with " +
        "`tailor setup delete`, then re-run.",
    );
  }
  const absFile = path.join(outputDir, AUTOFIX_WORKFLOW_FILE);
  const existing = lock?.autofix;
  const fileExists = fs.existsSync(absFile);
  const currentContent = fileExists ? fs.readFileSync(absFile, "utf-8") : null;
  const decision = decideAction({ existing, fileExists, currentContent, force });
  if (decision.action === "conflict") {
    throw new Error(`${AUTOFIX_WORKFLOW_FILE}: ${decision.reason}`);
  }
  const { content, contentHash, managedHashes } = reconcileContent({
    file: AUTOFIX_WORKFLOW_FILE,
    decision,
    existing,
    currentContent,
    render,
  });

  fs.mkdirSync(path.dirname(absFile), { recursive: true });
  fs.writeFileSync(absFile, content, "utf-8");
  writeLock(outputDir, {
    ...lock,
    version: LOCK_VERSION,
    targets: lock?.targets ?? [],
    autofix: {
      file: AUTOFIX_WORKFLOW_FILE,
      templateVersion: TEMPLATE_VERSION,
      inputs: {
        ...providerParams,
        dirs,
        packageManager,
        packageManagerAutoDetected: options.packageManager === undefined,
        ...(codemod ? codemodParams : {}),
      },
      generatedIds: render.generatedIds,
      contentHash,
      managedHashes,
    },
  });
  logWritten(decision, AUTOFIX_WORKFLOW_FILE);

  return { provider, ...codemodParams };
}

const SECRETS_STEP = [
  "   tailor setup ci env                        # gh commands for the repository secret and variable",
  "   tailor setup ci env --format terraform     # or Terraform",
  "   tailor setup ci env --check                # then what is still missing",
];

const PROVIDER_STEPS: Record<AutofixProvider, string[]> = {
  "github-token": [
    "1. Approve the checks on each fix commit: GitHub holds the pull request workflows of a",
    '   commit that GitHub Actions pushed until someone with write access selects "Approve',
    '   workflows to run" on the pull request. To run them without approval, regenerate with',
    "   --provider github-app.",
  ],
  "autofix-ci": [
    "1. Install the autofix.ci GitHub App on this repository: https://github.com/apps/autofix-ci",
  ],
  securefix: [
    "1. Set up the securefix server repository and its client and server GitHub Apps",
    "   (https://github.com/csm-actions/securefix-action), then set the client App's client ID",
    "   and private key:",
    ...SECRETS_STEP,
  ],
  "github-app": [
    "1. Create a GitHub App with the Contents read and write permission, install it on this",
    "   repository, and set its client ID and private key:",
    ...SECRETS_STEP,
  ],
};

function agentSteps(result: AutofixSetupResult): string[] | undefined {
  if (!isAutofixAgent(result.codemod)) return undefined;
  const bots = `   Among bots, only ${AGENT_BOT}[bot] can start the agent.`;
  const [secret] = agentRequirements(result);
  if (!secret) {
    return [
      '2. Allow "Copilot CLI billed to the organization" in the Copilot policies of the',
      "   organization, so the copilot agent signs in with the workflow token.",
      bots,
    ];
  }
  return [
    `2. Set the ${secret.name} repository secret the ${result.codemod} agent signs in with:`,
    ...SECRETS_STEP,
    bots,
  ];
}

/**
 * Print next-step guidance after generating the autofix workflow.
 * @param result - What {@link setupAutofix} generated
 */
export function printAutofixNextSteps(result: AutofixSetupResult): void {
  logger.newline();
  logger.info("Next steps:");
  logger.newline();
  for (const line of PROVIDER_STEPS[result.provider]) logger.log(line);
  const agent = agentSteps(result);
  if (agent) {
    logger.newline();
    for (const line of agent) logger.log(line);
  }
  logger.newline();
  logger.log(`${agent ? 3 : 2}. Commit the generated files:`);
  logger.log(`   - ${AUTOFIX_WORKFLOW_FILE}`);
  logger.log("   - .github/tailor.lock");
}
