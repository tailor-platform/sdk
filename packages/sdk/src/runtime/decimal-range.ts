import type { Decimal } from "decimal.js";

// PostgreSQL's numeric limits: digits before and after the decimal point.
const MAX_INTEGER_DIGITS = 131072;
const MAX_FRACTION_DIGITS = 16383;

/**
 * Whether a finite Decimal fits the range the Platform stores. Checking before
 * `toFixed()` keeps a value like `1e999999999` from expanding into a billion digits.
 * @param value - A finite Decimal
 * @returns `true` when the digits before and after the point are within the numeric limits
 * @internal
 */
export function isStorableDecimal(value: Decimal): boolean {
  return value.e < MAX_INTEGER_DIGITS && value.decimalPlaces() <= MAX_FRACTION_DIGITS;
}
