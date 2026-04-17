import type { DefinedFieldMetadata, FieldMetadata, TailorFieldType } from "./field-types";

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
