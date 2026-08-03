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

type GlobalWithRegistry = typeof globalThis & {
  [WAIT_POINT_REGISTRY_KEY]?: RegisteredWaitPoint[];
};

function registry(): RegisteredWaitPoint[] {
  const g = globalThis as GlobalWithRegistry;
  let entries = g[WAIT_POINT_REGISTRY_KEY];
  if (!entries) {
    entries = [];
    g[WAIT_POINT_REGISTRY_KEY] = entries;
  }
  return entries;
}

/**
 * Record a declared wait point key so the CLI can check it against the key
 * rules once the declaring module has loaded.
 * @param entry - The key and the declaration it came from
 */
export function registerWaitPoint(entry: RegisteredWaitPoint): void {
  registry().push(entry);
}

/**
 * Read every wait point declared by the modules loaded so far.
 * @returns The registered wait points, in declaration order
 */
export function getRegisteredWaitPoints(): readonly RegisteredWaitPoint[] {
  return registry();
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
  registry().length = mark;
}
