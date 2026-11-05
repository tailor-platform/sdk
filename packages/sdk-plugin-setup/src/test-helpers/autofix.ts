import {
  AUTOFIX_WORKFLOW_FILE,
  renderAutofixWorkflow,
  TEMPLATE_VERSION,
  type AutofixCodemod,
  type AutofixProvider,
  type PackageManager,
  type RenderResult,
} from "../templates";
import type { AutofixSetupOptions } from "../autofix";
import type { LockAutofix } from "../lock";

const SECUREFIX_SERVER_REPOSITORY = "securefix-server";

/**
 * Renders the autofix workflow of a provider, with a server repository for securefix.
 * @param provider - Autofix provider
 * @param options - App directories, package manager, and codemod mode, defaulting to the root
 *   app, pnpm, and no codemod
 * @param options.dirs - App directories
 * @param options.packageManager - Package manager
 * @param options.codemod - Codemod mode
 * @returns Rendered workflow
 */
export function renderAutofixFor(
  provider: AutofixProvider,
  options: {
    dirs?: readonly string[];
    packageManager?: PackageManager;
    codemod?: AutofixCodemod;
  } = {},
): RenderResult {
  const common = {
    dirs: ["."],
    packageManager: "pnpm" as const,
    codemod: undefined,
    ...options,
  };
  return provider === "securefix"
    ? renderAutofixWorkflow({
        ...common,
        provider,
        securefixServerRepository: SECUREFIX_SERVER_REPOSITORY,
      })
    : renderAutofixWorkflow({ ...common, provider });
}

/**
 * Builds the lock entry of an autofix workflow.
 * @param provider - Autofix provider
 * @param inputs - Inputs that differ from the root app with a detected pnpm
 * @returns Lock entry
 */
export function autofixLockEntry(
  provider: AutofixProvider,
  inputs: Partial<LockAutofix["inputs"]> = {},
): LockAutofix {
  return {
    file: AUTOFIX_WORKFLOW_FILE,
    templateVersion: TEMPLATE_VERSION,
    inputs: {
      provider,
      dirs: ["."],
      packageManager: "pnpm",
      packageManagerAutoDetected: true,
      ...(provider === "securefix"
        ? { securefixServerRepository: SECUREFIX_SERVER_REPOSITORY }
        : {}),
      ...inputs,
    },
    generatedIds: [],
    contentHash: "managed-v1:sha256:0",
  };
}

/**
 * Builds `setupAutofix` options for the root app, committing with the workflow token and no
 * codemods.
 * @param outputDir - Repository root
 * @param overrides - Options that differ
 * @returns Setup options
 */
export function autofixSetupOptions(
  outputDir: string,
  overrides: Partial<AutofixSetupOptions> = {},
): AutofixSetupOptions {
  return {
    provider: "github-token",
    codemod: undefined,
    dir: ".",
    force: false,
    outputDir,
    ...overrides,
  };
}
