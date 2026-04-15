import {
  createGetDB,
  type Generated,
  type Timestamp,
  type NamespaceDB,
  type NamespaceInsertable,
  type NamespaceSelectable,
  type NamespaceTable,
  type NamespaceTableName,
  type NamespaceTransaction,
  type NamespaceUpdateable,
} from "@tailor-platform/sdk/kysely";

export interface Namespace {
  "main-db": {
    Order: {
      id: Generated<string>;
      customerName: string;
      amount: number;
      status: "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED";
      createdAt: Generated<Timestamp>;
      updatedAt: Generated<Timestamp | null>;
    }

    User: {
      id: Generated<string>;
      name: string;
      email: string;
      age: number;
      createdAt: Generated<Timestamp>;
      updatedAt: Generated<Timestamp | null>;
    }
  }
}

export const getDB = createGetDB<Namespace>();

export type DB<N extends keyof Namespace = keyof Namespace> = NamespaceDB<Namespace, N>;

export type Transaction<K extends keyof Namespace | DB = keyof Namespace> =
  NamespaceTransaction<Namespace, K>;

type TableName = NamespaceTableName<Namespace>;
export type Table<T extends TableName> = NamespaceTable<Namespace, T>;

export type Insertable<T extends TableName> = NamespaceInsertable<Namespace, T>;
export type Selectable<T extends TableName> = NamespaceSelectable<Namespace, T>;
export type Updateable<T extends TableName> = NamespaceUpdateable<Namespace, T>;
