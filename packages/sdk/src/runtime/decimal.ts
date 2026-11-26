import { Decimal } from "decimal.js";
import { isStorableDecimal } from "./decimal-range";

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
  // decimal.js turns an exponent below its minimum into zero instead of throwing.
  if (value.isZero() && /[1-9]/.test(text.split(/e/i, 1)[0] ?? "")) {
    throw new RangeError("Decimal is out of range");
  }
  return value;
}

export { Decimal };
