type TailordbGlobal = { tailordb?: unknown };

/**
 * Install a no-op `globalThis.tailordb` so that user modules evaluated outside
 * the platform runtime (the CLI loading a config, the Vitest host reading one)
 * can construct `tailordb.Client` at module scope, as `createGetDB` in
 * `@tailor-platform/sdk/kysely` does, without a `ReferenceError`. Nothing
 * that issues queries runs in those places, so the client does nothing.
 * @returns A function that restores the previous `globalThis.tailordb`
 */
export function installTailordbClientStub(): () => void {
  const target = globalThis as TailordbGlobal;
  const previous = Object.getOwnPropertyDescriptor(target, "tailordb");
  target.tailordb = {
    Client: class {
      constructor(_config: { namespace: string }) {}
      async connect(): Promise<void> {}
      async end(): Promise<void> {}
      async queryObject(): Promise<Record<string, never>> {
        return {};
      }
    },
  };
  return () => {
    if (previous) Object.defineProperty(target, "tailordb", previous);
    else delete target.tailordb;
  };
}
