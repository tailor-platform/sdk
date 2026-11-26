import { Decimal } from "decimal.js";

/**
 * Parse decimal text into a Decimal.
 * @param text - Text already validated as a decimal string
 * @returns The Decimal
 * @throws {RangeError} When Decimal cannot represent the text, so callers can report it as a validation issue
 * @internal
 */
export function parseDecimal(text: string): Decimal {
  try {
    return new Decimal(text);
  } catch (error) {
    throw new RangeError(error instanceof Error ? error.message : String(error), { cause: error });
  }
}

export { Decimal };
