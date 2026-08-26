/**
 * How a wait point key reached the SDK. The declaration decides what the key
 * may contain: only `define` sees the key as a literal type, so only it can
 * type the `$params` a key carries.
 */
export type WaitPointDeclaration = "createWaitPoint" | "define" | "property";

/** A wait point key as declared, before the deploy-time key rules run. */
export interface RegisteredWaitPoint {
  key: string;
  declaredBy: WaitPointDeclaration;
}

const WAIT_POINT_REGISTRY_KEY: unique symbol = Symbol.for(
  "tailor-platform/sdk:wait-point-registry",
);

interface Registry {
  entries: RegisteredWaitPoint[];
  scopeStart: number;
}

type GlobalWithRegistry = typeof globalThis & {
  [WAIT_POINT_REGISTRY_KEY]?: Registry;
};

function registry(): Registry {
  const g = globalThis as GlobalWithRegistry;
  let state = g[WAIT_POINT_REGISTRY_KEY];
  if (!state) {
    state = { entries: [], scopeStart: 0 };
    g[WAIT_POINT_REGISTRY_KEY] = state;
  }
  return state;
}

/**
 * Record a declared wait point key so the CLI can check it against the key
 * rules once the declaring module has loaded.
 * @param entry - The key and the declaration it came from
 */
export function registerWaitPoint(entry: RegisteredWaitPoint): void {
  registry().entries.push(entry);
}

/**
 * Read every wait point declared by the modules loaded so far.
 * @returns The registered wait points, in declaration order
 */
export function getRegisteredWaitPoints(): readonly RegisteredWaitPoint[] {
  return registry().entries;
}

/**
 * Start a scope here, so what a run declares can be told apart from what an
 * earlier one left behind.
 *
 * The registry is process-wide, and a run that fails partway still leaves its
 * keys in it. Without a scope, a second run in the same process would be judged
 * on the first run's keys as well as its own.
 */
export function beginWaitPointScope(): void {
  const state = registry();
  state.scopeStart = state.entries.length;
}

/**
 * Read the wait points declared since {@link beginWaitPointScope}, or every one
 * of them when no scope was started.
 * @returns The wait points registered in the current scope, in declaration order
 */
export function getScopedWaitPoints(): readonly RegisteredWaitPoint[] {
  const state = registry();
  return state.entries.slice(state.scopeStart);
}

/**
 * Drop everything registered after a mark, where the mark is the length
 * {@link getRegisteredWaitPoints} returned earlier.
 *
 * The registry is process-wide, so a test that declares a key `deploy` rejects
 * would otherwise leave it for the deploy-time check another test file runs.
 * Nothing outside a test needs this: a CLI run declares one project's keys and
 * checks all of them.
 * @param mark - The registry length to return to
 */
export function restoreWaitPointRegistry(mark: number): void {
  const state = registry();
  state.entries.length = mark;
  if (state.scopeStart > mark) state.scopeStart = mark;
}
