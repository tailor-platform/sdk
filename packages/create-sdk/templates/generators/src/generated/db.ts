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
    Category: {
      id: Generated<string>;
      name: string;
      slug: string;
      parentCategoryId: string | null;
    }

    Order: {
      id: Generated<string>;
      productId: string;
      userId: string;
      quantity: number;
      totalPrice: number;
      status: "PENDING" | "CONFIRMED" | "SHIPPED" | "DELIVERED" | "CANCELLED";
      createdAt: Generated<Timestamp>;
      updatedAt: Timestamp | null;
    }

    Product: {
      id: Generated<string>;
      name: string;
      description: string | null;
      price: number;
      status: "DRAFT" | "ACTIVE" | "DISCONTINUED";
      categoryId: string | null;
      createdAt: Generated<Timestamp>;
      updatedAt: Timestamp | null;
    }

    User: {
      id: Generated<string>;
      name: string;
      email: string;
      role: "ADMIN" | "MEMBER" | "VIEWER";
      createdAt: Generated<Timestamp>;
      updatedAt: Timestamp | null;
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
