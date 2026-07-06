/**
 * Mock controls for Tailor Platform APIs (vitest).
 *
 * Each `xMock()` factory installs `vi.fn()`-backed mocks for one platform
 * namespace onto `globalThis` when acquired, and restores the previous value
 * when the `using` scope exits. State lives in the per-acquisition vi.fns /
 * closures — there is no shared global state bag — so nested/sequential scopes
 * are isolated and namespaces never interfere with each other.
 *
 * Acquire a mock with a `using` declaration:
 *
 * ```ts
 * test("...", () => {
 *   using wf = mockWorkflow();
 *   wf.setJobHandler(() => ({ ok: true }));
 * }); // previous workflow mock restored here
 * ```
 *
 * The friendly helpers (`setJobHandler`, `enqueueResult`, `triggeredJobs`, …)
 * are thin wrappers over the underlying vi.fns, which are also exposed directly
 * (`wf.triggerJobFunction`) for native matchers like
 * `expect(wf.triggerJobFunction).toHaveBeenCalledWith(...)`.
 */

export { RUNTIME_FLAG_KEY } from "./globals";

// Re-export the base globals install/cleanup under their historical names so
// non-environment tests (which run in the plain `node` environment) can set up
// the base platform surface — `globalThis.tailor`, error classes — themselves.
export {
  installPlatformGlobals as injectMocks,
  cleanupPlatformGlobals as cleanupMocks,
} from "./globals";

export { mockAigateway } from "./mocks/aigateway";
export { mockAuthconnection } from "./mocks/authconnection";
export { mockFile } from "./mocks/file";
export { mockIconv } from "./mocks/iconv";
export { mockIdp } from "./mocks/idp";
export { mockSecretmanager } from "./mocks/secretmanager";
export { mockTailordb } from "./mocks/tailordb";
export { mockWorkflow } from "./mocks/workflow";
