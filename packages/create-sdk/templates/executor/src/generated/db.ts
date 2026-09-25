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
    AuditLog: {
      id: Generated<string>;
      action: string;
      entityType: string;
      entityId: string;
      message: string;
      createdAt: Generated<Timestamp>;
      updatedAt: Generated<Timestamp>;
    }

    Notification: {
      id: Generated<string>;
      userId: string;
      title: string;
      body: string;
      isRead: boolean;
      createdAt: Generated<Timestamp>;
      updatedAt: Generated<Timestamp>;
    }

    User: {
      id: Generated<string>;
      name: string;
      email: string;
      role: "ADMIN" | "MEMBER";
      createdAt: Generated<Timestamp>;
      updatedAt: Generated<Timestamp>;
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
