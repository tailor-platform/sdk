// Symbol.for ensures the same symbol is returned across different ESM module instances,
// avoiding identity mismatches when multiple copies of the SDK are loaded.
export const SDK_BRAND: unique symbol = Symbol.for("tailor-platform/sdk");

/**
 * Adds a non-enumerable SDK brand symbol to the given object (in-place).
 * @param value - The object to brand
 * @returns The same object with the brand applied
 */
export function brandValue<T extends object>(value: T): T {
  Object.defineProperty(value, SDK_BRAND, {
    value: true,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return value;
}

/**
 * Checks whether the given value has been branded by the SDK.
 * @param value - The value to check
 * @returns True if the value has the SDK brand symbol
 */
export function isSdkBranded(value: unknown): boolean {
  return value !== null && typeof value === "object" && SDK_BRAND in value;
}
