// Symbol.for ensures the same symbol is returned across different ESM module instances,
// avoiding identity mismatches when multiple copies of the SDK are loaded.
export const SDK_BRAND: unique symbol = Symbol.for("tailor-platform/sdk");

export type SdkBrandKind = "tailordb-type" | "resolver" | "executor" | "workflow" | "workflow-job";

/**
 * Adds a non-enumerable SDK brand symbol to the given object (in-place).
 * The brand stores the kind so service loaders can distinguish between
 * different SDK object types (e.g. a type loader skips executors).
 * @param value - The object to brand
 * @param kind - The kind of SDK object
 * @returns The same object with the brand applied
 */
export function brandValue<T extends object>(value: T, kind: SdkBrandKind): T {
  Object.defineProperty(value, SDK_BRAND, {
    value: kind,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return value;
}

/**
 * Checks whether the given value has been branded by the SDK.
 * When kind is specified, only returns true if the brand matches that kind.
 * @param value - The value to check
 * @param kind - Optional kind to match against
 * @returns True if the value has the SDK brand symbol (and matches kind if specified)
 */
export function isSdkBranded(value: unknown, kind?: SdkBrandKind): boolean {
  if (value === null || typeof value !== "object" || !(SDK_BRAND in value)) return false;
  const stored = (value as Record<symbol, unknown>)[SDK_BRAND];
  // Legacy SDK versions store `true` instead of a kind string.
  // Without kind filter, any brand matches. With kind filter, legacy `true` also matches.
  return kind === undefined || stored === true || stored === kind;
}
