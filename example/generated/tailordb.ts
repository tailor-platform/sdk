import {
  createGetDB,
  type Generated,
  type TemporalDate,
  type TemporalInstant,
  type TemporalTime,
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
    AuditTrail: {
      id: Generated<string>;
      action: string;
      detail: string;
      createdAt: Generated<TemporalInstant>;
      updatedAt: Generated<TemporalInstant>;
    }

    Customer: {
      id: Generated<string>;
      name: string;
      email: string;
      phone: string | null;
      country: string;
      postalCode: string;
      address: string | null;
      city: string | null;
      fullAddress: string;
      state: string;
      createdAt: Generated<TemporalInstant>;
      updatedAt: Generated<TemporalInstant>;
    }

    Invoice: {
      id: Generated<string>;
      invoiceNumber: Serial<string>;
      salesOrderID: string;
      amount: number | null;
      sequentialId: Serial<number>;
      status: "draft" | "sent" | "paid" | "cancelled" | null;
      createdAt: Generated<TemporalInstant>;
      updatedAt: Generated<TemporalInstant>;
    }

    NestedProfile: {
      id: Generated<string>;
      userInfo: ObjectColumnType<{
        name: string;
        age?: number | null;
        bio?: string | null;
        email: string;
        phone?: string | null;
      }>;
      metadata: ObjectColumnType<{
        created: TemporalInstant;
        lastUpdated?: TemporalInstant | null;
        version: number;
      }>;
      archived: boolean | null;
      createdAt: Generated<TemporalInstant>;
      updatedAt: Generated<TemporalInstant>;
    }

    ProductBundle: {
      id: Generated<string>;
      name: string;
      label: string | null;
      items: {
        productName: string;
        qty: number;
        unitPrice: number;
      }[];
      createdAt: Generated<TemporalInstant>;
      updatedAt: Generated<TemporalInstant>;
    }

    PurchaseOrder: {
      id: Generated<string>;
      supplierID: string;
      totalPrice: number;
      discount: number | null;
      status: string;
      attachedFiles: {
        id: string;
        name: string;
        size: number;
        type: "text" | "image";
      }[];
      createdAt: Generated<TemporalInstant>;
      updatedAt: Generated<TemporalInstant>;
    }

    SalesOrder: {
      id: Generated<string>;
      customerID: string;
      approvedByUserIDs: string[] | null;
      totalPrice: number | null;
      discount: number | null;
      status: string | null;
      cancelReason: string | null;
      canceledAt: TemporalInstant | null;
      createdAt: Generated<TemporalInstant>;
      updatedAt: Generated<TemporalInstant>;
    }

    SalesOrderCreated: {
      id: Generated<string>;
      salesOrderID: string;
      customerID: string;
      totalPrice: number | null;
      status: string | null;
    }

    Selfie: {
      id: Generated<string>;
      name: string;
      parentID: string | null;
      dependId: string | null;
    }

    Supplier: {
      id: Generated<string>;
      name: string;
      phone: string;
      fax: string | null;
      email: string | null;
      postalCode: string;
      country: string;
      state: "Alabama" | "Alaska";
      city: string;
      createdAt: Generated<TemporalInstant>;
      updatedAt: Generated<TemporalInstant>;
    }

    TemporalCheck: {
      id: Generated<string>;
      eventDate: TemporalDate;
      eventDatetime: TemporalInstant;
      eventTime: TemporalTime;
      checkedAt: TemporalInstant;
    }

    User: {
      id: Generated<string>;
      name: string;
      email: string;
      status: string | null;
      department: string | null;
      role: "MANAGER" | "STAFF";
      createdAt: Generated<TemporalInstant>;
      updatedAt: Generated<TemporalInstant>;
    }

    UserLog: {
      id: Generated<string>;
      userID: string;
      message: string;
      createdAt: Generated<TemporalInstant>;
      updatedAt: Generated<TemporalInstant>;
    }

    UserSetting: {
      id: Generated<string>;
      language: "jp" | "en";
      userID: string;
      createdAt: Generated<TemporalInstant>;
      updatedAt: Generated<TemporalInstant>;
    }
  },
  "analyticsdb": {
    Event: {
      id: Generated<string>;
      name: "CLICK" | "VIEW" | "PURCHASE";
      createdAt: Generated<TemporalInstant>;
      updatedAt: Generated<TemporalInstant>;
    }
  }
}

export const getDB = createGetDB<Namespace>({ temporal: true });

export type DB<N extends keyof Namespace = keyof Namespace> = NamespaceDB<Namespace, N>;

export type Transaction<K extends keyof Namespace | DB = keyof Namespace> =
  NamespaceTransaction<Namespace, K>;

type TableName = NamespaceTableName<Namespace>;
export type Table<T extends TableName> = NamespaceTable<Namespace, T>;

export type Insertable<T extends TableName> = NamespaceInsertable<Namespace, T>;
export type Selectable<T extends TableName> = NamespaceSelectable<Namespace, T>;
export type Updateable<T extends TableName> = NamespaceUpdateable<Namespace, T>;
