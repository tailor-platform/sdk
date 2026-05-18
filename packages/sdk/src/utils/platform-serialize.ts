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

  // `JSON.stringify` returns undefined when the root value is a function/symbol.
  if (serialized === undefined) {
    throw new TypeError("platformSerialize: value at <root> is not JSON-serializable");
  }
  return JSON.parse(serialized) as T;
}

function formatPath(key: string): string {
  return key === "" ? "<root>" : `"${key}"`;
}
