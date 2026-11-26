import { Decimal } from "decimal.js";

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

/**
 * Parse decimal text into a Decimal.
 * @param text - Text already validated as a decimal string
 * @returns The Decimal
 * @throws {RangeError} When Decimal cannot represent the text or the value is out of the storable range, so callers can report it as a validation issue
 * @internal
 */
export function parseDecimal(text: string): Decimal {
  let value: Decimal;
  try {
    value = new Decimal(text);
  } catch (error) {
    throw new RangeError(error instanceof Error ? error.message : String(error), { cause: error });
  }
  if (!isStorableDecimal(value)) throw new RangeError("Decimal is out of range");
  return value;
}

export { Decimal };
