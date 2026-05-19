/**
 * Validate and serialize a value as it would cross the Platform JSON boundary.
 *
 * Mirrors the runtime checks the platform performs on workflow arguments,
 * wait payloads, and trigger inputs so that local tests fail in the same
 * places production fails.
 *
 * Throws on:
 * - `NaN` / `Infinity` / `-Infinity` (`JSON.stringify` would silently emit `null`)
 * - `BigInt` (TypeError is thrown by `JSON.stringify`; we emit a clearer message)
 * - Non-plain objects (class instances, including `Date`, `Map`, `Set`, `Error`,
 *   and user-defined DTOs whose prototype is not `Object.prototype`)
 *
 * The replacer reads `this[key]` so the check sees the original value before
 * any `toJSON` conversion (e.g. `Date.prototype.toJSON`).
 * @param value - Value to validate and round-trip
 * @returns The JSON-normalized value (undefined/function properties stripped, etc.)
 */
export function platformSerialize<T>(value: T): T {
  // Top-level undefined is allowed (matches the no-input convention for jobs);
  // JSON.stringify(undefined) would otherwise yield the string "undefined" and
  // JSON.parse would throw on it.
  if (value === undefined) return undefined as T;

  // Root-level function/symbol would make JSON.stringify return undefined,
  // which we report below as a generic error. Catch them here so the message
  // is specific (mirrors the per-property messages produced by the replacer).
  if (typeof value === "function") {
    throw new TypeError("platformSerialize: function is not JSON-serializable at <root>");
  }
  if (typeof value === "symbol") {
    throw new TypeError("platformSerialize: Symbol is not JSON-serializable at <root>");
  }

  const serialized = JSON.stringify(value, function (key, val) {
    if (typeof val === "number" && !Number.isFinite(val)) {
      throw new TypeError(
        `platformSerialize: non-finite number at ${formatPath(key)}: ${String(val)}`,
      );
    }
    if (typeof val === "bigint") {
      throw new TypeError(
        `platformSerialize: BigInt is not JSON-serializable at ${formatPath(key)}`,
      );
    }
    // Look at the pre-toJSON value so Date/Map/Set/etc. can be detected.
    const raw = (this as Record<string, unknown>)[key];
    if (raw !== null && typeof raw === "object" && !Array.isArray(raw)) {
      const proto = Object.getPrototypeOf(raw);
      if (proto !== Object.prototype && proto !== null) {
        const ctor = (raw as { constructor?: { name?: string } }).constructor?.name ?? "anonymous";
        throw new TypeError(
          `platformSerialize: non-plain object at ${formatPath(key)} (${ctor} instance)`,
        );
      }
    }
    return val;
  });

  return JSON.parse(serialized as string) as T;
}

function formatPath(key: string): string {
  return key === "" ? "<root>" : `"${key}"`;
}
