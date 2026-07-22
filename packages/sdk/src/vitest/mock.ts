/**
 * Mock controls for Tailor Platform APIs (vitest).
 *
 * Each `mockX()` factory installs `vi.fn()`-backed mocks for one platform
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
 *   wf.job(processOrder).mockResolvedValue({ ok: true });
 * }); // previous workflow mock restored here
 * ```
 *
 * Runtime operations are exposed as typed Vitest mocks where possible. Service-
 * specific helpers cover stateful fixtures, query matching, and compatibility
 * with the original queue and aggregate-call APIs.
 */

export { RUNTIME_FLAG_KEY } from "./globals";

// Re-export the base globals install/cleanup under their historical names so
// non-environment tests (which run in the plain `node` environment) can set up
// the base platform surface — `globalThis.tailor`, error classes — themselves.
export {
  installPlatformGlobals as injectMocks,
  cleanupPlatformGlobals as cleanupMocks,
} from "./globals";

export { mockAigateway, type MockAigatewayOptions } from "./mocks/aigateway";
export { mockAuthconnection, type MockAuthconnectionOptions } from "./mocks/authconnection";
export { mockFile, type MockFileOptions } from "./mocks/file";
export { mockIconv, type MockIconvOptions } from "./mocks/iconv";
export { mockIdp, type MockIdpOptions } from "./mocks/idp";
export { mockSecretmanager, type MockSecretmanagerOptions } from "./mocks/secretmanager";
export {
  mockTailordb,
  type MockTailordbOptions,
  type QueryBehavior,
  type QueryMatch,
  type QueryMatcher,
} from "./mocks/tailordb";
export { mockWorkflow } from "./mocks/workflow";
