import {
  AUTOFIX_WORKFLOW_FILE,
  renderAutofixWorkflow,
  TEMPLATE_VERSION,
  type AutofixProvider,
  type PackageManager,
  type RenderResult,
} from "../templates";
import type { LockAutofix } from "../lock";

const SECUREFIX_SERVER_REPOSITORY = "securefix-server";

/**
 * Renders the autofix workflow of a provider, with a server repository for securefix.
 * @param provider - Autofix provider
 * @param options - App directories and package manager, defaulting to the root app and pnpm
 * @param options.dirs - App directories
 * @param options.packageManager - Package manager
 * @returns Rendered workflow
 */
export function renderAutofixFor(
  provider: AutofixProvider,
  options: { dirs?: readonly string[]; packageManager?: PackageManager } = {},
): RenderResult {
  const common = { dirs: ["."], packageManager: "pnpm" as const, ...options };
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
