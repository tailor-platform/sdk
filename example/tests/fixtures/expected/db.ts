import {
  createGetDB,
  type Generated,
  type UUIDString,
  type Timestamp,
  type ObjectColumnType,
  type Serial,
  type NamespaceDB,
  type NamespaceInsertable,
  type NamespaceSelectable,
  type NamespaceTable,
  type NamespaceTableName,
  type NamespaceTransaction,
  type NamespaceUpdateable,
} from "@tailor-platform/sdk/kysely";

export interface Namespace {
  "tailordb": {
    Customer: {
      id: Generated<UUIDString>;
      name: string;
      email: string;
      phone: string | null;
      country: string;
      postalCode: string;
      address: string | null;
      city: string | null;
      fullAddress: Generated<string>;
      state: string;
      createdAt: Generated<Timestamp>;
      updatedAt: Generated<Timestamp>;
    }

    Invoice: {
      id: Generated<UUIDString>;
      invoiceNumber: Serial<string>;
      salesOrderID: UUIDString;
      amount: number | null;
      sequentialId: Serial<number>;
      status: "draft" | "sent" | "paid" | "cancelled" | null;
      createdAt: Generated<Timestamp>;
      updatedAt: Generated<Timestamp>;
    }

    NestedProfile: {
      id: Generated<UUIDString>;
      userInfo: ObjectColumnType<{
        name: string;
        age?: number | null;
        bio?: string | null;
        email: string;
        phone?: string | null;
      }>;
      metadata: ObjectColumnType<{
        created: Timestamp;
        lastUpdated?: Timestamp | null;
        version: number;
      }>;
      archived: boolean | null;
      createdAt: Generated<Timestamp>;
      updatedAt: Generated<Timestamp>;
    }

    PurchaseOrder: {
      id: Generated<UUIDString>;
      supplierID: UUIDString;
      totalPrice: number;
      discount: number | null;
      status: string;
      attachedFiles: {
        id: UUIDString;
        name: string;
        size: number;
        type: "text" | "image";
      }[];
      createdAt: Generated<Timestamp>;
      updatedAt: Generated<Timestamp>;
    }

    SalesOrder: {
      id: Generated<UUIDString>;
      customerID: UUIDString;
      approvedByUserIDs: UUIDString[] | null;
      totalPrice: number | null;
      discount: number | null;
      status: string | null;
      cancelReason: string | null;
      canceledAt: Timestamp | null;
      createdAt: Generated<Timestamp>;
      updatedAt: Generated<Timestamp>;
    }

    SalesOrderCreated: {
      id: Generated<UUIDString>;
      salesOrderID: UUIDString;
      customerID: UUIDString;
      totalPrice: number | null;
      status: string | null;
    }

    Selfie: {
      id: Generated<UUIDString>;
      name: string;
      parentID: UUIDString | null;
      dependId: UUIDString | null;
    }

    Supplier: {
      id: Generated<UUIDString>;
      name: string;
      phone: string;
      fax: string | null;
      email: string | null;
      postalCode: string;
      country: string;
      state: "Alabama" | "Alaska";
      city: string;
      createdAt: Generated<Timestamp>;
      updatedAt: Generated<Timestamp>;
    }

    User: {
      id: Generated<UUIDString>;
      name: string;
      email: string;
      status: string | null;
      department: string | null;
      role: "MANAGER" | "STAFF";
      createdAt: Generated<Timestamp>;
      updatedAt: Generated<Timestamp>;
    }

    UserLog: {
      id: Generated<UUIDString>;
      userID: UUIDString;
      message: string;
      createdAt: Generated<Timestamp>;
      updatedAt: Generated<Timestamp>;
    }

    UserSetting: {
      id: Generated<UUIDString>;
      language: "jp" | "en";
      userID: UUIDString;
      createdAt: Generated<Timestamp>;
      updatedAt: Generated<Timestamp>;
    }
  },
  "analyticsdb": {
    Event: {
      id: Generated<UUIDString>;
      name: "CLICK" | "VIEW" | "PURCHASE";
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
