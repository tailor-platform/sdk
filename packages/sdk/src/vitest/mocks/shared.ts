// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

// Attach a non-enumerable `Symbol.dispose` to a facade so it works with `using`.
export function withDispose<T extends object>(facade: T, dispose: () => void): T & Disposable {
  Object.defineProperty(facade, Symbol.dispose, {
    value: dispose,
    enumerable: false,
    writable: true,
    configurable: true,
  });
  return facade as T & Disposable;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function tailorRoot(): Record<string, any> {
  const g = globalThis as Record<string, unknown>;
  if (!g.tailor) {
    // Ensure the container (and the always-present context stub) exists even if
    // the base globals were not installed (e.g. a unit test that only acquires
    // a single mock without the tailor-runtime environment).
    g.tailor = { context: { getInvoker: () => null } };
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return g.tailor as Record<string, any>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function tailordbRoot(): Record<string, any> {
  const g = globalThis as Record<string, unknown>;
  if (!g.tailordb) {
    g.tailordb = {};
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return g.tailordb as Record<string, any>;
}
