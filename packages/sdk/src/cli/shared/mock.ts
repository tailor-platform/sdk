import { installTailordbClientStub } from "#/utils/tailordb-client-stub";

/**
 * Install a stub `globalThis.tailordb` so that user code loaded by the CLI
 * (e.g. via `createGetDB` in `@tailor-platform/sdk/kysely`) can reference
 * `tailordb.Client` without hitting a `ReferenceError`. The CLI never
 * actually executes the user code paths that issue queries, so a no-op
 * client suffices.
 *
 * Exposed as a function (rather than a top-level statement) so that
 * `package.json#sideEffects` can keep the file marked side-effect-free
 * without bundlers eliminating the install step.
 */
export function installCliTailordbStub(): void {
  installTailordbClientStub();
}
