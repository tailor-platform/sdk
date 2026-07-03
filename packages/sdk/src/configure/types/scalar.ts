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

type ScalarHelpers<T extends string> = {
  isString: (value: unknown) => value is T;
  parseString: (value: unknown, label?: string) => T;
  assertString: (value: unknown, label?: string) => asserts value is T;
};

function makeScalarHelpers<T extends string>(
  isValid: (value: string) => boolean,
  expected: string,
): ScalarHelpers<T> {
  const isString = (value: unknown): value is T => typeof value === "string" && isValid(value);
  const parseString = (value: unknown, label = "value"): T => {
    if (isString(value)) return value;
    throw scalarTypeError(label, expected);
  };
  const assertString = (value: unknown, label?: string): asserts value is T => {
    parseString(value, label);
  };

  return { isString, parseString, assertString };
}

const uuidString: ScalarHelpers<UUIDString> = makeScalarHelpers<UUIDString>(
  isValidUUIDString,
  "UUID string",
);
const dateString: ScalarHelpers<DateString> = makeScalarHelpers<DateString>(
  isValidDateString,
  "date string",
);
const dateTimeString: ScalarHelpers<DateTimeString> = makeScalarHelpers<DateTimeString>(
  isValidDateTimeString,
  "datetime string",
);
const timeString: ScalarHelpers<TimeString> = makeScalarHelpers<TimeString>(
  isValidTimeString,
  "time string",
);
const decimalString: ScalarHelpers<DecimalString> = makeScalarHelpers<DecimalString>(
  isValidDecimalString,
  "decimal string",
);

/**
 * Check whether a value is a UUID string accepted by Tailor fields.
 * @param value - Value to check
 * @returns True when the value is a UUID string
 */
export function isUUIDString(value: unknown): value is UUIDString {
  return uuidString.isString(value);
}

/**
 * Check whether a value is a date string accepted by Tailor fields.
 * @param value - Value to check
 * @returns True when the value matches `yyyy-MM-dd`
 */
export function isDateString(value: unknown): value is DateString {
  return dateString.isString(value);
}

/**
 * Check whether a value is a datetime string accepted by Tailor fields.
 * @param value - Value to check
 * @returns True when the value matches the supported ISO datetime format
 */
export function isDateTimeString(value: unknown): value is DateTimeString {
  return dateTimeString.isString(value);
}

/**
 * Check whether a value is a time string accepted by Tailor fields.
 * @param value - Value to check
 * @returns True when the value matches `HH:mm`
 */
export function isTimeString(value: unknown): value is TimeString {
  return timeString.isString(value);
}

/**
 * Check whether a value is a decimal string accepted by Tailor fields.
 * @param value - Value to check
 * @returns True when the value is a decimal string
 */
export function isDecimalString(value: unknown): value is DecimalString {
  return decimalString.isString(value);
}

/**
 * Parse a value as a UUID string.
 * @param value - Value to parse
 * @param label - Name used in the error message
 * @returns The original value typed as `UUIDString`
 */
export function parseUUIDString(value: unknown, label = "value"): UUIDString {
  return uuidString.parseString(value, label);
}

/**
 * Parse a value as a date string.
 * @param value - Value to parse
 * @param label - Name used in the error message
 * @returns The original value typed as `DateString`
 */
export function parseDateString(value: unknown, label = "value"): DateString {
  return dateString.parseString(value, label);
}

/**
 * Parse a value as a datetime string.
 * @param value - Value to parse
 * @param label - Name used in the error message
 * @returns The original value typed as `DateTimeString`
 */
export function parseDateTimeString(value: unknown, label = "value"): DateTimeString {
  return dateTimeString.parseString(value, label);
}

/**
 * Parse a value as a time string.
 * @param value - Value to parse
 * @param label - Name used in the error message
 * @returns The original value typed as `TimeString`
 */
export function parseTimeString(value: unknown, label = "value"): TimeString {
  return timeString.parseString(value, label);
}

/**
 * Parse a value as a decimal string.
 * @param value - Value to parse
 * @param label - Name used in the error message
 * @returns The original value typed as `DecimalString`
 */
export function parseDecimalString(value: unknown, label = "value"): DecimalString {
  return decimalString.parseString(value, label);
}

/**
 * Assert that a value is a UUID string.
 * @param value - Value to check
 * @param label - Name used in the error message
 */
export function assertUUIDString(value: unknown, label?: string): asserts value is UUIDString {
  uuidString.assertString(value, label);
}

/**
 * Assert that a value is a date string.
 * @param value - Value to check
 * @param label - Name used in the error message
 */
export function assertDateString(value: unknown, label?: string): asserts value is DateString {
  dateString.assertString(value, label);
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
  dateTimeString.assertString(value, label);
}

/**
 * Assert that a value is a time string.
 * @param value - Value to check
 * @param label - Name used in the error message
 */
export function assertTimeString(value: unknown, label?: string): asserts value is TimeString {
  timeString.assertString(value, label);
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
  decimalString.assertString(value, label);
}
