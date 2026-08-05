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

export type NamespaceInsertable<NS, T extends NamespaceTableName<NS>> = Insertable<
  NamespaceTable<NS, T>
>;
export type NamespaceSelectable<NS, T extends NamespaceTableName<NS>> = Selectable<
  NamespaceTable<NS, T>
>;
export type NamespaceUpdateable<NS, T extends NamespaceTableName<NS>> = Updateable<
  NamespaceTable<NS, T>
>;

/**
 * A TailorDB table (`typeof myTable`) or a bare field collection.
 */
export type TailorDBColumnsSource = TailorAnyDBType | Record<string, TailorAnyDBField>;

type DBFieldsOf<T> = T extends TailorAnyDBType ? T["fields"] : T;

type ColumnOf<F> = F extends TailorAnyDBField
  ? IsReadOnlyDBField<F> extends true
    ? Serial<output<F>>
    : IsAutoFilledDBField<F> extends true
      ? Generated<output<F>>
      : output<F>
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
 * type.
 * @example
 * function createInput<const F extends Record<string, TailorAnyDBField>>(fields: F) {
 *   return (input: TailorDBInsertable<F>) => { ... };
 * }
 */
export type TailorDBColumns<T extends TailorDBColumnsSource> = {
  [K in keyof DBFieldsOf<T>]: K extends "id"
    ? Generated<output<DBFieldsOf<T>[K]>>
    : ColumnOf<DBFieldsOf<T>[K]>;
};

// Kysely composes its input types out of intersections. Flattening them keeps the
// shape readable in assignability errors and editor tooltips.
type FlattenColumns<T> = { [K in keyof T]: T[K] } & {};

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
