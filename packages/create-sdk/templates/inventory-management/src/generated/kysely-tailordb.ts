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
      description: string | null;
      createdAt: Generated<Timestamp>;
      updatedAt: Generated<Timestamp>;
    }

    Contact: {
      id: Generated<UUIDString>;
      name: string;
      email: string;
      phone: string | null;
      address: string | null;
      createdAt: Generated<Timestamp>;
      updatedAt: Generated<Timestamp>;
    }

    Inventory: {
      id: Generated<UUIDString>;
      productId: UUIDString;
      quantity: number;
      createdAt: Generated<Timestamp>;
      updatedAt: Generated<Timestamp>;
    }

    Notification: {
      id: Generated<UUIDString>;
      message: string;
      createdAt: Generated<Timestamp>;
      updatedAt: Generated<Timestamp>;
    }

    Order: {
      id: Generated<UUIDString>;
      name: string;
      description: string | null;
      orderDate: Timestamp;
      orderType: "PURCHASE" | "SALES";
      contactId: UUIDString;
      createdAt: Generated<Timestamp>;
      updatedAt: Generated<Timestamp>;
    }

    OrderItem: {
      id: Generated<UUIDString>;
      orderId: UUIDString;
      productId: UUIDString;
      quantity: number;
      unitPrice: number;
      totalPrice: number | null;
      createdAt: Generated<Timestamp>;
      updatedAt: Generated<Timestamp>;
    }

    Product: {
      id: Generated<UUIDString>;
      name: string;
      description: string | null;
      categoryId: UUIDString;
      createdAt: Generated<Timestamp>;
      updatedAt: Generated<Timestamp>;
    }

    User: {
      id: Generated<UUIDString>;
      name: string;
      email: string;
      role: "MANAGER" | "STAFF";
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
