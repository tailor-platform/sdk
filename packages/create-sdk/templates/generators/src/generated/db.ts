import {
  createGetDB,
  type Generated,
  type UUIDString,
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
      id: Generated<UUIDString>;
      name: string;
      slug: string;
      parentCategoryId: UUIDString | null;
    }

    Order: {
      id: Generated<UUIDString>;
      productId: UUIDString;
      userId: UUIDString;
      quantity: number;
      totalPrice: number;
      status: "PENDING" | "CONFIRMED" | "SHIPPED" | "DELIVERED" | "CANCELLED";
      createdAt: Generated<Timestamp>;
      updatedAt: Generated<Timestamp>;
    }

    Product: {
      id: Generated<UUIDString>;
      name: string;
      description: string | null;
      price: number;
      status: "DRAFT" | "ACTIVE" | "DISCONTINUED";
      categoryId: UUIDString | null;
      createdAt: Generated<Timestamp>;
      updatedAt: Generated<Timestamp>;
    }

    User: {
      id: Generated<UUIDString>;
      name: string;
      email: string;
      role: "ADMIN" | "MEMBER" | "VIEWER";
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
