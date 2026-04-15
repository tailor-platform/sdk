import {
  createGetDB,
  type Generated,
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
      id: Generated<string>;
      name: string;
      description: string | null;
      parentCategoryId: string | null;
    }

    Comment: {
      id: Generated<string>;
      body: string;
      taskId: string;
      authorId: string;
      metadata: ObjectColumnType<{
        source: string;
        editedAt?: Timestamp | null;
        isInternal: boolean;
      }>;
      createdAt: Generated<Timestamp>;
      updatedAt: Generated<Timestamp | null>;
    }

    Task: {
      id: Generated<string>;
      title: string;
      description: string | null;
      status: "TODO" | "IN_PROGRESS" | "DONE" | "CANCELLED";
      priority: number;
      dueDate: Timestamp | null;
      assigneeId: string | null;
      categoryId: string | null;
      isArchived: boolean;
      createdAt: Generated<Timestamp>;
      updatedAt: Generated<Timestamp | null>;
    }

    User: {
      id: Generated<string>;
      name: string;
      email: string;
      role: "ADMIN" | "MEMBER" | "VIEWER";
      bio: string | null;
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
