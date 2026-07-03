import {
  isValidDateString,
  isValidDateTimeString,
  isValidDecimalString,
  isValidTimeString,
  isValidUUIDString,
} from "./field-format";
import type {
  DateString,
  DateTimeString,
  DecimalString,
  TimeString,
  UUIDString,
} from "./scalar.types";

function scalarTypeError(label: string, expected: string): TypeError {
  return new TypeError(`${label} must be a ${expected}`);
}

/**
 * Check whether a value is a UUID string accepted by Tailor fields.
 * @param value - Value to check
 * @returns True when the value is a UUID string
 */
export function isUUIDString(value: unknown): value is UUIDString {
  return typeof value === "string" && isValidUUIDString(value);
}

/**
 * Check whether a value is a date string accepted by Tailor fields.
 * @param value - Value to check
 * @returns True when the value matches `yyyy-MM-dd`
 */
export function isDateString(value: unknown): value is DateString {
  return typeof value === "string" && isValidDateString(value);
}

/**
 * Check whether a value is a datetime string accepted by Tailor fields.
 * @param value - Value to check
 * @returns True when the value matches the supported ISO datetime format
 */
export function isDateTimeString(value: unknown): value is DateTimeString {
  return typeof value === "string" && isValidDateTimeString(value);
}

/**
 * Check whether a value is a time string accepted by Tailor fields.
 * @param value - Value to check
 * @returns True when the value matches `HH:mm`
 */
export function isTimeString(value: unknown): value is TimeString {
  return typeof value === "string" && isValidTimeString(value);
}

/**
 * Check whether a value is a decimal string accepted by Tailor fields.
 * @param value - Value to check
 * @returns True when the value is a decimal string
 */
export function isDecimalString(value: unknown): value is DecimalString {
  return typeof value === "string" && isValidDecimalString(value);
}

/**
 * Parse a value as a UUID string.
 * @param value - Value to parse
 * @param label - Name used in the error message
 * @returns The original value typed as `UUIDString`
 */
export function parseUUIDString(value: unknown, label = "value"): UUIDString {
  if (isUUIDString(value)) return value;
  throw scalarTypeError(label, "UUID string");
}

/**
 * Parse a value as a date string.
 * @param value - Value to parse
 * @param label - Name used in the error message
 * @returns The original value typed as `DateString`
 */
export function parseDateString(value: unknown, label = "value"): DateString {
  if (isDateString(value)) return value;
  throw scalarTypeError(label, "date string");
}

/**
 * Parse a value as a datetime string.
 * @param value - Value to parse
 * @param label - Name used in the error message
 * @returns The original value typed as `DateTimeString`
 */
export function parseDateTimeString(value: unknown, label = "value"): DateTimeString {
  if (isDateTimeString(value)) return value;
  throw scalarTypeError(label, "datetime string");
}

/**
 * Parse a value as a time string.
 * @param value - Value to parse
 * @param label - Name used in the error message
 * @returns The original value typed as `TimeString`
 */
export function parseTimeString(value: unknown, label = "value"): TimeString {
  if (isTimeString(value)) return value;
  throw scalarTypeError(label, "time string");
}

/**
 * Parse a value as a decimal string.
 * @param value - Value to parse
 * @param label - Name used in the error message
 * @returns The original value typed as `DecimalString`
 */
export function parseDecimalString(value: unknown, label = "value"): DecimalString {
  if (isDecimalString(value)) return value;
  throw scalarTypeError(label, "decimal string");
}

/**
 * Assert that a value is a UUID string.
 * @param value - Value to check
 * @param label - Name used in the error message
 */
export function assertUUIDString(value: unknown, label?: string): asserts value is UUIDString {
  parseUUIDString(value, label);
}

/**
 * Assert that a value is a date string.
 * @param value - Value to check
 * @param label - Name used in the error message
 */
export function assertDateString(value: unknown, label?: string): asserts value is DateString {
  parseDateString(value, label);
}

/**
 * Assert that a value is a datetime string.
 * @param value - Value to check
 * @param label - Name used in the error message
 */
export function assertDateTimeString(
  value: unknown,
  label?: string,
): asserts value is DateTimeString {
  parseDateTimeString(value, label);
}

/**
 * Assert that a value is a time string.
 * @param value - Value to check
 * @param label - Name used in the error message
 */
export function assertTimeString(value: unknown, label?: string): asserts value is TimeString {
  parseTimeString(value, label);
}

/**
 * Assert that a value is a decimal string.
 * @param value - Value to check
 * @param label - Name used in the error message
 */
export function assertDecimalString(
  value: unknown,
  label?: string,
): asserts value is DecimalString {
  parseDecimalString(value, label);
}
