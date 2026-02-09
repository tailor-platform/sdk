import {
  type ColumnType,
  Kysely,
  type KyselyConfig,
  type Transaction as KyselyTransaction,
  type Insertable as KyselyInsertable,
  type Selectable as KyselySelectable,
  type Updateable as KyselyUpdateable,
  TailordbDialect,
} from "@tailor-platform/sdk/kysely";

type Timestamp = ColumnType<Date, Date | string, Date | string>;
type Generated<T> = T extends ColumnType<infer S, infer I, infer U>
  ? ColumnType<S, I | undefined, U>
  : ColumnType<T, T | undefined, T>;

export interface Namespace {
  "main-db": {
    User: {
      id: Generated<string>;
      name: string;
      email: string;
      age: number;
      createdAt: Generated<Timestamp>;
      updatedAt: Timestamp | null;
    }
  }
}

export function getDB<const N extends keyof Namespace>(
  namespace: N,
  kyselyConfig?: Omit<KyselyConfig, "dialect">,
): Kysely<Namespace[N]> {
  const client = new tailordb.Client({ namespace });
  return new Kysely<Namespace[N]>({
    dialect: new TailordbDialect(client),
    ...kyselyConfig,
  });
}

export type DB<N extends keyof Namespace = keyof Namespace> = ReturnType<typeof getDB<N>>;

export type Transaction<K extends keyof Namespace | DB = keyof Namespace> =
  K extends DB<infer N>
    ? KyselyTransaction<Namespace[N]>
    : K extends keyof Namespace
      ? KyselyTransaction<Namespace[K]>
      : never;

type TableName = {
  [N in keyof Namespace]: keyof Namespace[N];
}[keyof Namespace];
export type Table<T extends TableName> = {
  [N in keyof Namespace]: T extends keyof Namespace[N] ? Namespace[N][T]
    : never;
}[keyof Namespace];

export type Insertable<T extends keyof Namespace[keyof Namespace]> = KyselyInsertable<
  Table<T>
>;
export type Selectable<T extends keyof Namespace[keyof Namespace]> = KyselySelectable<
  Table<T>
>;
export type Updateable<T extends keyof Namespace[keyof Namespace]> = KyselyUpdateable<
  Table<T>
>;
