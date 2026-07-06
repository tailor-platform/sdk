// Generic field structural types, options, and validation types.
//
// This is a pure type module: type declarations only, no zod/schema
// references, importable type-only from any layer.

import type {
  DateString,
  DateTimeString,
  DecimalString,
  TimeString,
  UUIDString,
} from "./scalar.types";

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

export type {
  DateString,
  DateTimeString,
  DecimalString,
  TimeString,
  TimeZoneOffsetString,
  UUIDString,
} from "./scalar.types";

export type TailorToTs = {
  string: string;
  integer: number;
  float: number;
  decimal: DecimalString;
  boolean: boolean;
  uuid: UUIDString;
  date: DateString;
  datetime: DateTimeString | Date;
  time: TimeString;
  enum: string;
  object: Record<string, unknown>;
  nested: Record<string, unknown>;
} & Record<TailorFieldType, unknown>;

export interface FieldMetadata {
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

// Return Output type based on FieldOptions.
export type FieldOutput<T, O extends FieldOptions> = OptionalFieldOutput<ArrayFieldOutput<T, O>, O>;

type OptionalFieldOutput<T, O extends FieldOptions> = O["optional"] extends true ? T | null : T;

export type ArrayFieldOutput<T, O extends FieldOptions> = [O] extends [
  {
    array: true;
  },
]
  ? T[]
  : T;

/**
 * Field validation function. Return an error message string to fail, or void/undefined to pass.
 */
export type ValidateFn<O> = (args: { value: O }) => string | void;

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
