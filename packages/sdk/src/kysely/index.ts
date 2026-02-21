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

export {
  type ColumnType,
  Kysely,
  type KyselyConfig,
  type Transaction,
  type Insertable,
  type Selectable,
  type Updateable,
} from "kysely";

export { TailordbDialect } from "@tailor-platform/function-kysely-tailordb";

export type Timestamp = ColumnType<Date, Date | string, Date | string>;
export type Generated<T> =
  T extends ColumnType<infer S, infer I, infer U>
    ? ColumnType<S, I | undefined, U>
    : ColumnType<T, T | undefined, T>;
export type Serial<T = string | number> = ColumnType<T, never, never>;

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

// === Module augmentation interface for TS Plugin / tailor-env.d.ts ===

/**
 * Empty interface augmented by `tailor-env.d.ts` via `declare module`.
 * When augmented, `getDB` becomes callable with type-safe namespace keys.
 * @example
 * ```ts
 * // In tailor-env.d.ts (auto-generated):
 * declare module "@tailor-platform/sdk/kysely" {
 *   interface GeneratedNamespace {
 *     tailordb: { User: InferTable<typeof user>; ... };
 *   }
 * }
 * ```
 */
// Using interface for declaration merging via `declare module`
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface GeneratedNamespace {}

/**
 * Get a Kysely instance for a namespace defined in `tailor-env.d.ts`.
 * Requires `GeneratedNamespace` to be augmented via `declare module`.
 * @param namespace - The namespace name
 * @param config - Optional Kysely configuration overrides
 * @returns A Kysely instance typed for the given namespace
 */
export function getDB<const N extends keyof GeneratedNamespace & string>(
  namespace: N,
  config?: Omit<KyselyConfig, "dialect">,
): TailordbKysely<GeneratedNamespace[N]> {
  const client = new tailordb.Client({ namespace });
  return new Kysely<GeneratedNamespace[N]>({
    dialect: new TailordbDialect(client),
    ...config,
  });
}

// Re-export inference utilities
export type { InferTable, InferNamespace, EnumRecord } from "./infer";
