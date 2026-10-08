// Generic field structural types, options, and validation types.
//
// This is a pure type module: type declarations only, no zod/schema
// references, importable type-only from any layer.

import type { IsUnion, TypeLevelError } from "#/types/helpers";
import type { Temporal } from "temporal-spec";

export interface EnumValue {
  value: string;
  description?: string;
}

export type TailorFieldType =
  | "uuid"
  | "string"
  | "boolean"
  | "integer"
  | "float"
  | "decimal"
  | "enum"
  | "date"
  | "datetime"
  | "time"
  | "nested";

export type TailorToTs = {
  string: string;
  integer: number;
  float: number;
  decimal: string;
  boolean: boolean;
  uuid: string;
  date: string;
  datetime: string | Date;
  time: string;
  enum: string;
  object: Record<string, unknown>;
  nested: Record<string, unknown>;
} & Record<TailorFieldType, unknown>;

export interface FieldMetadata {
  /** Date value representation. `"default"` follows the configured `defaultDateRepresentation`. */
  as?: "string" | "date" | "temporal" | "default";
  description?: string;
  required?: boolean;

  array?: boolean;
  allowedValues?: EnumValue[];
  // Validation supports any field output type (the field itself remains typed elsewhere).
  // oxlint-disable-next-line no-explicit-any
  validate?: FieldValidateInput<any>[];
  typeName?: string;
}

export interface DefinedFieldMetadata {
  type: TailorFieldType;
  array: boolean;
  description?: boolean;
  validate?: boolean;
  typeName?: boolean;
}

export type FieldOptions = {
  optional?: boolean;
  array?: boolean;
};

/**
 * Registry of each application's `defaultDateRepresentation`. `tailor generate`
 * writes one entry per application into `tailor.d.ts`, keyed by the app name:
 * `declare module "@tailor-platform/sdk" { interface DateRepresentationRegistry { shop: "temporal" } }`.
 * An app without the setting is recorded as `"unset"`. Application names are
 * unique within a workspace, so two entries never share a key.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface DateRepresentationRegistry {}

/** Representation the SDK applies when no app configures one. */
type BuiltinDateDefault = undefined;

export type DateDefaultConflictMessage =
  "defaultDateRepresentation differs between the tailor.config.ts files included in this TypeScript program; use the same value in each, or give each application its own tsconfig.json";

// Distributes over the union of recorded settings.
type DateDefaultOfValue<Value> = Value extends "temporal"
  ? "temporal"
  : Value extends "unset"
    ? undefined
    : never;

// Distributes over the union of settings so that every unset app is read as
// the built-in default before the settings are compared.
type NormalizeDateDefault<Value, Builtin> = Value extends undefined ? Builtin : Value;

/**
 * Resolve the default date representation declared by a registry: the single
 * value every included app agrees on, or a type-level error when they differ.
 */
export type DateDefaultOf<Registry, Builtin = BuiltinDateDefault> = [
  DateDefaultOfValue<Registry[keyof Registry]>,
] extends [never]
  ? Builtin
  : IsUnion<
        NormalizeDateDefault<DateDefaultOfValue<Registry[keyof Registry]>, Builtin>
      > extends true
    ? TypeLevelError<DateDefaultConflictMessage>
    : NormalizeDateDefault<DateDefaultOfValue<Registry[keyof Registry]>, Builtin>;

type DefaultDateRepresentation = DateDefaultOf<DateRepresentationRegistry>;

export type HasDateDefaultConflict =
  DefaultDateRepresentation extends TypeLevelError<string> ? true : false;

/** Explicit `as` values a date field accepts. */
export type DateRepresentationOption = "string" | "date" | "temporal";

type ResolveDateRepresentation<As, Default> = As extends DateRepresentationOption ? As : Default;

/** Options for a date field. */
export type DateFieldOptions = FieldOptions & {
  /**
   * Use a Date at midnight UTC, or a Temporal.PlainDate, instead of a
   * YYYY-MM-DD string. Defaults to `defaultDateRepresentation`, or string.
   */
  as?: DateRepresentationOption;
};

type DateValueOf<R> = R extends "date"
  ? Date
  : R extends "temporal"
    ? Temporal.PlainDate
    : R extends TypeLevelError<string>
      ? R
      : string;

/** Value type of a date field under an explicit `Default` representation. */
export type DateFieldValueFor<As, Default> = DateValueOf<ResolveDateRepresentation<As, Default>>;

export type DateFieldValue<As> = DateFieldValueFor<As, DefaultDateRepresentation>;

/** Options for a datetime field. */
export type DateTimeFieldOptions = FieldOptions & {
  /**
   * Choose string, Date, or Temporal.Instant values. Defaults to
   * `defaultDateRepresentation`, or string input and string | Date output.
   */
  as?: DateRepresentationOption;
};

type DateTimeValueOf<R> = R extends "date"
  ? Date
  : R extends "temporal"
    ? Temporal.Instant
    : R extends "string"
      ? string
      : R extends TypeLevelError<string>
        ? R
        : string | Date;

/** Value type of a datetime field under an explicit `Default` representation. */
export type DateTimeFieldValueFor<As, Default> = DateTimeValueOf<
  ResolveDateRepresentation<As, Default>
>;

export type DateTimeFieldValue<As> = DateTimeFieldValueFor<As, DefaultDateRepresentation>;

/** Options for a time field. */
export type TimeFieldOptions = FieldOptions & {
  /**
   * Choose HH:mm strings, Date values on 1970-01-01 UTC, or Temporal.PlainTime values.
   * Defaults to `defaultDateRepresentation`, or string. Date output uses UTC
   * hours/minutes and ignores the date. Seconds and fractional seconds are
   * truncated in both representations.
   */
  as?: DateRepresentationOption;
};

type TimeValueOf<R> = R extends "date"
  ? Date
  : R extends "temporal"
    ? Temporal.PlainTime
    : R extends TypeLevelError<string>
      ? R
      : string;

/** Value type of a time field under an explicit `Default` representation. */
export type TimeFieldValueFor<As, Default> = TimeValueOf<ResolveDateRepresentation<As, Default>>;

export type TimeFieldValue<As> = TimeFieldValueFor<As, DefaultDateRepresentation>;

// Return Output type based on FieldOptions.
export type FieldOutput<T, O extends FieldOptions> = OptionalFieldOutput<ArrayFieldOutput<T, O>, O>;

type OptionalFieldOutput<T, O extends FieldOptions> = O["optional"] extends true ? T | null : T;

type ArrayFieldOutput<T, O extends FieldOptions> = [O] extends [
  {
    array: true;
  },
]
  ? T[]
  : T;

/**
 * Field validation function. Return an error message string to fail, or void/undefined to pass.
 */
type ValidateFn<O> = (args: { value: O }) => string | void;

/**
 * Input type for field validation
 */
export type FieldValidateInput<O> = ValidateFn<O>;

/**
 * Minimal structural interface for TailorField.
 * Defines only the properties needed by parser, plugin, cli, and types layers.
 * The full interface with builder methods (description, typeName, validate, parse)
 * is defined in configure/types/type.ts.
 */
export interface TailorField<
  Defined extends DefinedFieldMetadata = DefinedFieldMetadata,
  // Generic default output type (kept loose on purpose for library ergonomics).
  // oxlint-disable-next-line no-explicit-any
  Output = any,
  M extends FieldMetadata = FieldMetadata,
  T extends TailorFieldType = TailorFieldType,
> {
  readonly type: T;
  readonly fields: Record<string, TailorAnyField>;
  readonly _defined: Defined;
  readonly _output: Output;
  readonly metadata: M;
}

// This helper type intentionally uses `any` as a placeholder for unknown field output.
// oxlint-disable-next-line no-explicit-any
export type TailorAnyField = TailorField<any>;
