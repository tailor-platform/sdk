import type { InferFieldsOutput } from "./helpers";
import type { PluginAttachment } from "./plugin";
import type { TailorField } from "./tailor-field";
import type {
  TailorDBTypeMetadata,
  RawRelationConfig,
  DBFieldMetadata,
  DefinedDBFieldMetadata,
} from "./tailordb";
import type { InferredAttributeMap } from "./user";

/**
 * Minimal structural interface for TailorDBField.
 * Defines only the properties needed by parser, plugin, cli, and types layers.
 * The full interface with builder methods (relation, index, unique, hooks, validate, etc.)
 * is defined in configure/services/tailordb/schema.ts.
 */
export interface TailorDBField<
  Defined extends DefinedDBFieldMetadata = DefinedDBFieldMetadata,
  // oxlint-disable-next-line no-explicit-any
  Output = any,
> extends Omit<TailorField<Defined, Output, DBFieldMetadata, Defined["type"]>, "fields"> {
  readonly fields: Record<string, TailorAnyDBField>;
  readonly rawRelation: Readonly<RawRelationConfig> | undefined;
}

// Helper alias: DB fields can be arbitrarily nested, so we intentionally keep this loose.
// oxlint-disable-next-line no-explicit-any
export type TailorAnyDBField = TailorDBField<any, any>;

/**
 * Minimal structural interface for TailorDBType.
 * Defines only the properties needed by parser, plugin, cli, and types layers.
 * The full interface with builder methods (hooks, validate, features, permission, etc.)
 * is defined in configure/services/tailordb/schema.ts.
 */
export interface TailorDBType<
  // Default kept loose to avoid forcing callers to supply generics.
  // oxlint-disable-next-line no-explicit-any
  Fields extends Record<string, TailorAnyDBField> = any,
  // Generic parameter kept for compatibility with full TailorDBType in configure/
  // oxlint-disable-next-line no-unused-vars
  User extends object = InferredAttributeMap,
> {
  readonly name: string;
  readonly fields: Fields;
  readonly _output: InferFieldsOutput<Fields>;
  readonly metadata: TailorDBTypeMetadata;
  readonly plugins: PluginAttachment[];
}

// Helper alias
// oxlint-disable-next-line no-explicit-any
export type TailorAnyDBType = TailorDBType<any, any>;

export type TailorDBInstance<
  // Default kept loose for convenience; callers still get fully inferred types from `db.type()`.
  // oxlint-disable-next-line no-explicit-any
  Fields extends Record<string, TailorAnyDBField> = any,
  User extends object = InferredAttributeMap,
> = TailorDBType<Fields, User>;
