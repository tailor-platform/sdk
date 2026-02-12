/**
 * Kysely integration module for generated TailorDB code.
 *
 * Re-exports kysely and function-kysely-tailordb types through a single import path
 * to avoid phantom dependency issues with pnpm, and provides namespace-aware
 * utility types and factory functions used by the code generator.
 */

import { TailordbDialect } from "@tailor-platform/function-kysely-tailordb";
import {
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

export type TailordbKysely<DB> = Kysely<DB>;
export type NamespaceDB<NS, N extends keyof NS = keyof NS> = TailordbKysely<NS[N]>;

/**
 * Create a Kysely instance configured with the TailorDB dialect.
 * @param namespace - The TailorDB namespace to connect to
 * @param config - Optional Kysely configuration (dialect is provided automatically)
 * @returns A Kysely instance for the given database type
 */
export function createTailordbKysely<DB>(
  namespace: string,
  config?: Omit<KyselyConfig, "dialect">,
): Kysely<DB> {
  const client = new tailordb.Client({ namespace });
  return new Kysely<DB>({
    dialect: new TailordbDialect(client),
    ...config,
  });
}

/**
 * Create a namespace-aware getDB function for generated code.
 * @returns A getDB function that creates Kysely instances for specific namespaces
 */
export function createGetDB<NS>() {
  return function getDB<const N extends keyof NS>(
    namespace: N,
    config?: Omit<KyselyConfig, "dialect">,
  ): TailordbKysely<NS[N]> {
    return createTailordbKysely<NS[N]>(namespace as string, config);
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
