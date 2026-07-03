import {
  createGetDB,
  type Generated,
  type UUIDString,
  type Timestamp,
  type ObjectColumnType,
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
    Category: {
      id: Generated<UUIDString>;
      name: string;
      description: string | null;
      parentCategoryId: UUIDString | null;
    }

    Comment: {
      id: Generated<UUIDString>;
      body: string;
      taskId: UUIDString;
      authorId: UUIDString;
      metadata: ObjectColumnType<{
        source: string;
        editedAt?: Timestamp | null;
        isInternal: boolean;
      }>;
      createdAt: Generated<Timestamp>;
      updatedAt: Generated<Timestamp>;
    }

    Task: {
      id: Generated<UUIDString>;
      title: string;
      description: string | null;
      status: "TODO" | "IN_PROGRESS" | "DONE" | "CANCELLED";
      priority: number;
      dueDate: Timestamp | null;
      assigneeId: UUIDString | null;
      categoryId: UUIDString | null;
      isArchived: Generated<boolean>;
      createdAt: Generated<Timestamp>;
      updatedAt: Generated<Timestamp>;
    }

    User: {
      id: Generated<UUIDString>;
      name: string;
      email: string;
      role: "ADMIN" | "MEMBER" | "VIEWER";
      bio: string | null;
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
