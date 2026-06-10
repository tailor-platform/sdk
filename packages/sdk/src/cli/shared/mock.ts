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
  (
    globalThis as unknown as {
      tailordb: {
        Client: typeof tailordb.Client;
      };
    }
  ).tailordb = {
    Client: class {
      constructor(_config: { namespace: string }) {}
      async connect(): Promise<void> {}
      async end(): Promise<void> {}
      async queryObject<O>(): Promise<tailordb.QueryResult<O>> {
        return {} as Promise<tailordb.QueryResult<O>>;
      }
    },
  };
}
