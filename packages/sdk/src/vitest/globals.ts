/**
 * Base platform globals for the tailor-runtime test environment.
 *
 * This module is intentionally free of any `vitest` (`vi`) dependency so it can
 * be imported from the Vitest *environment* module (which runs in a realm where
 * `vi` is not available). It installs only the always-present structural pieces:
 *
 * - `globalThis.tailor` / `globalThis.tailordb` container objects
 * - `globalThis.tailor.context.getInvoker` default stub
 * - the platform error classes (`TailorErrors`, `TailorErrorMessage`,
 *   `TailorDBFileError`)
 * - the `__tailorRuntimeActive` sentinel flag
 *
 * The per-namespace mock behavior (TailorDB client, workflow, secretmanager, …)
 * is installed on demand by the `xMock()` factories in `./mock`, which run in
 * test context where `vi` *is* available.
 */

import { createDefaultWorkflowRuntime } from "./workflow-runtime";
import type { ContextInvoker } from "../runtime/context";
import type { TailorDBFileErrorCode } from "../runtime/file";

// Sentinel set when the tailor-runtime environment is active. setup.ts reads it
// to decide whether to run its blocked-globals lifecycle and config-secret
// loading.
export const RUNTIME_FLAG_KEY = "__tailorRuntimeActive";

// ---------------------------------------------------------------------------
// Error class mocks
// ---------------------------------------------------------------------------

interface TailorErrorItem {
  message: string;
  path: (string | number)[];
}

class TailorErrorsMock extends Error {
  errors: TailorErrorItem[];

  constructor(errors: TailorErrorItem[]) {
    if (!Array.isArray(errors)) {
      throw new TypeError("TailorErrors: errors must be an array");
    }
    const validated = errors.map((e, i) => {
      if (typeof e.message !== "string") {
        throw new TypeError(`TailorErrors: errors[${i}].message must be a string`);
      }
      if (!Array.isArray(e.path)) {
        throw new TypeError(`TailorErrors: errors[${i}].path must be an array`);
      }
      return { message: e.message, path: e.path };
    });
    // Match the PF runtime's TailorErrors serialization, which prefixes the
    // JSON payload with "TailorErrors: ". Other SDK code (e.g. apply
    // integration fixtures) strips this prefix before JSON.parse.
    super(`TailorErrors: ${JSON.stringify({ errors: validated })}`);
    this.name = "TailorErrors";
    this.errors = validated;
  }
}

class TailorErrorMessageMock extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TailorErrorMessage";
  }
}

class TailorDBFileErrorMock extends Error {
  code?: TailorDBFileErrorCode;
  override cause: unknown;

  constructor(message: string, code?: TailorDBFileErrorCode, cause?: unknown) {
    super(message);
    this.name = "TailorDBFileError";
    this.code = code;
    this.cause = cause;
  }
}

// ---------------------------------------------------------------------------
// Base install / cleanup
// ---------------------------------------------------------------------------

// Stub-only injection. SDK consumers configure invokers at the body level
// (resolver/executor/workflow `.body()` `invoker` arg) or, for bundled tests,
// via `vi.spyOn(globalThis.tailor.context, "getInvoker")`.
function defaultGetInvoker(): ContextInvoker | null {
  return null;
}

/**
 * Install the always-present base platform globals (containers, context stub,
 * error classes, runtime flag). Per-namespace mocks are layered on top by the
 * `xMock()` factories in `./mock`.
 * @param global - The global object to install into (typically `globalThis`)
 */
export function installPlatformGlobals(global: typeof globalThis): void {
  const g = global as Record<string, unknown>;

  g[RUNTIME_FLAG_KEY] = true;

  // Containers. Namespace mocks (secretmanager, …) are added to these by the
  // corresponding `xMock()` on acquisition. `workflow` carries a default runner
  // so `.trigger()` runs the real job chain locally without `mockWorkflow()`;
  // `mockWorkflow()` overlays and restores it.
  g.tailor = {
    context: { getInvoker: defaultGetInvoker },
    workflow: createDefaultWorkflowRuntime(),
  };
  g.tailordb = {};

  g.TailorErrors = TailorErrorsMock;
  g.TailorErrorMessage = TailorErrorMessageMock;
  g.TailorDBFileError = TailorDBFileErrorMock;
}

/**
 * Remove the base platform globals (and anything the namespace mocks layered on
 * top, since they live under the same containers).
 * @param global - The global object to clean up (typically `globalThis`)
 */
export function cleanupPlatformGlobals(global: typeof globalThis): void {
  const g = global as Record<string, unknown>;
  delete g.tailordb;
  delete g.tailor;
  delete g.TailorErrors;
  delete g.TailorErrorMessage;
  delete g.TailorDBFileError;
  delete g[RUNTIME_FLAG_KEY];
}
