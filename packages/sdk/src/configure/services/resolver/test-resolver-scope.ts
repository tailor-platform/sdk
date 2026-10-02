/**
 * Test-time marker for code running inside a resolver `body`, so the
 * `tailor-runtime` Vitest setup can apply `defaultDateRepresentation` only
 * where deployed resolver bundles apply it.
 * @internal
 */
import { AsyncLocalStorage } from "node:async_hooks";

type AsyncLocalStorageLike<T> = {
  getStore(): T | undefined;
  run<R>(store: T, callback: () => R): R;
};

let scopeStorage: AsyncLocalStorageLike<true> | undefined;

function resolverScopeStorage(): AsyncLocalStorageLike<true> {
  if (!scopeStorage) {
    scopeStorage = new AsyncLocalStorage<true>();
  }
  return scopeStorage;
}

/**
 * Run a resolver body inside the resolver test scope.
 * @param run - The resolver body invocation
 * @returns The body's result
 * @internal
 */
export function withResolverTestScope<T>(run: () => T): T {
  return resolverScopeStorage().run(true, run);
}

/**
 * Check whether the current code runs inside a resolver body under test.
 * @returns Whether a resolver body is executing
 * @internal
 */
export function isInResolverTestScope(): boolean {
  return scopeStorage?.getStore() === true;
}
