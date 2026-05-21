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
      description: string | null;
      createdAt: Generated<Timestamp>;
      updatedAt: Generated<Timestamp | null>;
    }

    Contact: {
      id: Generated<string>;
      name: string;
      email: string;
      phone: string | null;
      address: string | null;
      createdAt: Generated<Timestamp>;
      updatedAt: Generated<Timestamp | null>;
    }

    Inventory: {
      id: Generated<string>;
      productId: string;
      quantity: number;
      createdAt: Generated<Timestamp>;
      updatedAt: Generated<Timestamp | null>;
    }

    Notification: {
      id: Generated<string>;
      message: string;
      createdAt: Generated<Timestamp>;
      updatedAt: Generated<Timestamp | null>;
    }

    Order: {
      id: Generated<string>;
      name: string;
      description: string | null;
      orderDate: Timestamp;
      orderType: "PURCHASE" | "SALES";
      contactId: string;
      createdAt: Generated<Timestamp>;
      updatedAt: Generated<Timestamp | null>;
    }

    OrderItem: {
      id: Generated<string>;
      orderId: string;
      productId: string;
      quantity: number;
      unitPrice: number;
      totalPrice: Generated<number | null>;
      createdAt: Generated<Timestamp>;
      updatedAt: Generated<Timestamp | null>;
    }

    Product: {
      id: Generated<string>;
      name: string;
      description: string | null;
      categoryId: string;
      createdAt: Generated<Timestamp>;
      updatedAt: Generated<Timestamp | null>;
    }

    User: {
      id: Generated<string>;
      name: string;
      email: string;
      role: "MANAGER" | "STAFF";
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
