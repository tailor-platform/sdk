/**
 * Kysely integration module for generated TailorDB code.
 *
 * Re-exports kysely and function-kysely-tailordb types through a single import path
 * to avoid phantom dependency issues with pnpm, and provides namespace-aware
 * utility types and factory functions used by the code generator.
 */

import { TailordbDialect } from "@tailor-platform/function-kysely-tailordb";
import {
  type ColumnType,
  Kysely,
  type Insertable,
  type KyselyConfig,
  type Selectable,
  type Transaction as KyselyTransaction,
  type Updateable,
} from "kysely";
import type {
  IsAutoFilledDBField,
  IsReadOnlyDBField,
  TailorAnyDBField,
  TailorAnyDBType,
} from "#/configure/services/tailordb/types";
import type { output, TypeLevelError } from "#/types/helpers";

export {
  type ColumnType,
  Kysely,
  type KyselyConfig,
  type Transaction,
  type Insertable,
  type Selectable,
  sql,
  type Updateable,
} from "kysely";

export { TailordbDialect } from "@tailor-platform/function-kysely-tailordb";

export type Timestamp = ColumnType<Date, Date | string, Date | string>;
type ResolveSelect<T> = T extends ColumnType<infer S, unknown, unknown> ? S : T;
type ResolveInsert<T> = T extends ColumnType<unknown, infer I, unknown> ? I : T;
type ResolveUpdate<T> = T extends ColumnType<unknown, unknown, infer U> ? U : T;
export type ObjectColumnType<T> = ColumnType<
  { [K in keyof T]-?: Exclude<ResolveSelect<T[K]>, undefined> },
  { [K in keyof T]: ResolveInsert<T[K]> },
  { [K in keyof T]: ResolveUpdate<T[K]> }
>;
export type ArrayColumnType<T> = ColumnType<
  ResolveSelect<T>[],
  ResolveInsert<T>[],
  ResolveUpdate<T>[]
>;
export type Generated<T> =
  T extends ColumnType<infer S, infer I, infer U>
    ? ColumnType<S, I | undefined, U>
    : ColumnType<T, T | undefined, T>;
// The insert/update types carry the reason as a string literal so that supplying a
// value fails with it, instead of the bare "does not exist" an absent key produces.
// `| undefined` is what makes the column omittable; Kysely drops undefined columns
// from the statement, so passing it explicitly is the same as leaving it out.
export type Serial<T = string | number> = ColumnType<
  T,
  TypeLevelError<"assigned by .serial(); remove it from the input"> | undefined,
  TypeLevelError<"assigned by .serial(); remove it from the input"> | undefined
>;

// Kysely composes its input types out of intersections. Flattening them keeps the
// shape readable in assignability errors and editor tooltips.
type FlattenColumns<T> = { [K in keyof T]: T[K] } & {};

export type TailordbKysely<DB> = Kysely<DB>;
export type NamespaceDB<NS, N extends keyof NS = keyof NS> = TailordbKysely<NS[N]>;

/**
 * Create a namespace-aware getDB function for generated code.
 * @returns A getDB function that creates Kysely instances for specific namespaces
 */
export function createGetDB<NS>() {
  return function getDB<const N extends keyof NS & string>(
    namespace: N,
    config?: Omit<KyselyConfig, "dialect">,
  ): TailordbKysely<NS[N]> {
    const client = new tailordb.Client({ namespace });
    return new Kysely<NS[N]>({
      dialect: new TailordbDialect(client),
      ...config,
    });
  };
}

export type NamespaceTransaction<NS, K extends keyof NS | TailordbKysely<NS[keyof NS]> = keyof NS> =
  K extends TailordbKysely<infer DB>
    ? KyselyTransaction<DB>
    : K extends keyof NS
      ? KyselyTransaction<NS[K]>
      : never;

export type NamespaceTableName<NS> = {
  [N in keyof NS]: keyof NS[N];
}[keyof NS];

export type NamespaceTable<NS, T extends NamespaceTableName<NS>> = {
  [N in keyof NS]: T extends keyof NS[N] ? NS[N][T] : never;
}[keyof NS];

export type NamespaceInsertable<NS, T extends NamespaceTableName<NS>> = FlattenColumns<
  Insertable<NamespaceTable<NS, T>>
>;
export type NamespaceSelectable<NS, T extends NamespaceTableName<NS>> = FlattenColumns<
  Selectable<NamespaceTable<NS, T>>
>;
export type NamespaceUpdateable<NS, T extends NamespaceTableName<NS>> = FlattenColumns<
  Updateable<NamespaceTable<NS, T>>
>;

/**
 * A TailorDB table (`typeof myTable`) or a bare field collection.
 */
export type TailorDBColumnsSource = TailorAnyDBType | Record<string, TailorAnyDBField>;

type DBFieldsOf<T> = T extends TailorAnyDBType ? T["fields"] : T;

// The column mapping below mirrors the one `kyselyTypePlugin` applies when it writes a
// table interface (`plugin/builtin/kysely-type/type-processor.ts`), so both surfaces
// resolve a field to the same column type — including inside nested objects, where the
// function runtime also hands back a Date for a date/datetime.
// `example/tests/kysely-parity.ts` pins the two against each other on real generator output.
type DBFieldType<F> = F extends TailorAnyDBField ? F["_defined"]["type"] : never;
type IsArrayDBField<F> = F extends TailorAnyDBField
  ? F["_defined"]["array"] extends true
    ? true
    : false
  : false;

type Unwrapped<F> = Exclude<output<F>, null>;
type ElementOutput<F> =
  IsArrayDBField<F> extends true
    ? Unwrapped<F> extends readonly (infer E)[]
      ? E
      : Unwrapped<F>
    : Unwrapped<F>;

type NestedFieldsOf<F> = F extends TailorAnyDBField ? F["fields"] : never;

// Nested props carry the same column mapping as top-level ones, so a datetime inside an
// object also resolves to Timestamp. The optional marker matches what the output type
// gives them, which is what the generator emits too.
// `-readonly` because a field collection is inferred with `const`, and the generated
// table interfaces declare their nested props mutable.
type NestedProps<Fields> = {
  -readonly [K in keyof Fields as null extends output<Fields[K]> ? never : K]: DBColumn<Fields[K]>;
} & {
  -readonly [K in keyof Fields as null extends output<Fields[K]> ? K : never]?: DBColumn<Fields[K]>;
};

// The generator reaches for ObjectColumnType only when the object holds something whose
// select and insert types differ: a timestamp, an optional prop, or a filled-in one.
type NestedNeedsColumnType<Fields> = true extends {
  [K in keyof Fields]: DBFieldType<Fields[K]> extends "date" | "datetime"
    ? true
    : null extends output<Fields[K]>
      ? true
      : DBFieldType<Fields[K]> extends "nested"
        ? NestedNeedsColumnType<NestedFieldsOf<Fields[K]>>
        : Fields[K] extends TailorAnyDBField
          ? IsAutoFilledDBField<Fields[K]>
          : false;
}[keyof Fields]
  ? true
  : false;

type NestedColumn<F> =
  NestedNeedsColumnType<NestedFieldsOf<F>> extends true
    ? ObjectColumnType<FlattenColumns<NestedProps<NestedFieldsOf<F>>>>
    : FlattenColumns<NestedProps<NestedFieldsOf<F>>>;

type ElementColumn<F> =
  DBFieldType<F> extends "date" | "datetime"
    ? Timestamp
    : DBFieldType<F> extends "nested"
      ? NestedColumn<F>
      : ElementOutput<F>;

// A ColumnType cannot sit inside an array — Kysely only unwraps it at the top level of a
// table property — so an array of them keeps the ColumnType outermost.
type ArrayedColumn<F> =
  IsArrayDBField<F> extends true
    ? ElementColumn<F> extends ColumnType<unknown, unknown, unknown>
      ? ArrayColumnType<ElementColumn<F>>
      : ElementColumn<F>[]
    : ElementColumn<F>;

type NullableColumn<F> = null extends output<F> ? ArrayedColumn<F> | null : ArrayedColumn<F>;

type DBColumn<F> = F extends TailorAnyDBField
  ? IsReadOnlyDBField<F> extends true
    ? Serial<NullableColumn<F>>
    : IsAutoFilledDBField<F> extends true
      ? Generated<NullableColumn<F>>
      : NullableColumn<F>
  : never;

/**
 * Kysely column types derived from a TailorDB table or field collection.
 *
 * Each field's read type is tagged with how the platform populates it, so
 * {@link Insertable}, {@link Selectable} and {@link Updateable} derive the same
 * shapes they do for the tables `kyselyTypePlugin` generates: `.serial()` fields are
 * never caller-supplied, `.default()` / `.hooks({ create })` fields may be omitted on
 * create, optional fields stay optional, and `id` is platform-generated.
 *
 * Pass a field collection when the fields are a type parameter — a shared module that
 * lets each project extend a table with its own fields cannot name a generated table
 * type. Declare it as `<const F extends Record<string, TailorAnyDBField>>` so the field
 * types are inferred; a bare `Record<string, TailorAnyDBField>` erases them and nothing
 * is checked.
 *
 * These types are meant to be handed to callers, not consumed inside the generic that
 * declares them: while `F` is still an unresolved type parameter the mapping stays
 * deferred, so assigning to it inside the function body reports the unevaluated
 * conditional rather than a readable shape.
 * @example
 * function createInput<const F extends Record<string, TailorAnyDBField>>(fields: F) {
 *   return (input: TailorDBInsertable<F>) => { ... };
 * }
 */
export type TailorDBColumns<T extends TailorDBColumnsSource> = {
  [K in keyof DBFieldsOf<T>]: K extends "id"
    ? Generated<output<DBFieldsOf<T>[K]>>
    : DBColumn<DBFieldsOf<T>[K]>;
};

/** Create input for a TailorDB table or field collection. See {@link TailorDBColumns}. */
export type TailorDBInsertable<T extends TailorDBColumnsSource> = FlattenColumns<
  Insertable<TailorDBColumns<T>>
>;

/** Read shape of a TailorDB table or field collection. See {@link TailorDBColumns}. */
export type TailorDBSelectable<T extends TailorDBColumnsSource> = FlattenColumns<
  Selectable<TailorDBColumns<T>>
>;

/** Update input for a TailorDB table or field collection. See {@link TailorDBColumns}. */
export type TailorDBUpdateable<T extends TailorDBColumnsSource> = FlattenColumns<
  Updateable<TailorDBColumns<T>>
>;
