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
  // Top-level undefined is allowed (jobs may take no input).
  if (value === undefined) return undefined as T;

  // Root function/symbol stringify to `undefined`; throw a specific message here.
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

  // `JSON.stringify` returns `undefined` when the root collapses (e.g. a `toJSON`
  // returning `undefined`); parsing that would throw opaquely.
  // JSON.stringify returns undefined for non-serializable values
  // oxlint-disable-next-line typescript/no-unnecessary-condition
  if (serialized === undefined) {
    throw new TypeError("platformSerialize: value is not JSON-serializable at <root>");
  }

  return JSON.parse(serialized) as T;
}

function formatPath(key: string): string {
  return key === "" ? "<root>" : `"${key}"`;
}
