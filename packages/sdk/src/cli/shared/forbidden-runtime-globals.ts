import { findUndefinedReferences } from "#/cli/shared/free-variables";
import { getForbiddenGlobalMessage, isForbiddenGlobal } from "#/utils/node-builtins";
import { CLIError } from "./errors";

/**
 * Throw a CLIError when bundled code still references a Node-only global
 * (`process`, `Buffer`, etc.) that the Tailor Platform runtime never defines.
 * Run this against already-bundled output, not source text — bundling
 * resolves every reachable import first, so any free variable left over is
 * either a genuine runtime global or unreachable dead code the bundler failed
 * to resolve (which `bundleLog.assertAllResolved()` already catches).
 * @param code - Bundled JavaScript to scan.
 * @param context - Human-readable description of what produced `code`, used in the error message.
 */
export function assertNoForbiddenRuntimeGlobals(code: string, context: string): void {
  const freeVars = findUndefinedReferences(code);
  const forbidden = [...freeVars].filter(isForbiddenGlobal).toSorted();
  if (forbidden.length === 0) return;

  const noun = forbidden.length === 1 ? "a global" : "globals";
  throw CLIError({
    code: "FORBIDDEN_RUNTIME_GLOBAL",
    message: `${context} references ${noun} unavailable in the Tailor Platform runtime: ${forbidden.join(", ")}.`,
    details: forbidden.map(getForbiddenGlobalMessage).join("\n"),
  });
}
