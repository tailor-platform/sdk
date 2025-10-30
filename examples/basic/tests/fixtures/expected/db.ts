import { type ColumnType, Kysely } from "kysely";
import { TailordbDialect } from "@tailor-platform/function-kysely-tailordb";

type Generated<T> = T extends ColumnType<infer S, infer I, infer U>
  ? ColumnType<S, I | undefined, U>
  : ColumnType<T, T | undefined, T>;
type Timestamp = ColumnType<Date, Date | string, Date | string>;
type AssertNonNull<T> = T extends ColumnType<infer S, infer I, infer U>
  ? ColumnType<NonNullable<S>, I | null, U | null>
  : ColumnType<NonNullable<T>, T | null, T | null>

interface Namespace {
  "tailordb": {
    Customer: {
      id: Generated<string>;
      name: string;
      email: string;
      phone: string | null;
      country: string;
      postalCode: string;
      address: string | null;
      city: string | null;
      fullAddress: string | null;
      state: string;
      createdAt: AssertNonNull<Timestamp>;
      updatedAt: Timestamp | null;
    }

    Invoice: {
      id: Generated<string>;
      invoiceNumber: string | null;
      salesOrderID: string;
      amount: number | null;
      sequentialId: number | null;
      status: "draft" | "sent" | "paid" | "cancelled" | null;
      createdAt: AssertNonNull<Timestamp>;
      updatedAt: Timestamp | null;
    }

    NestedProfile: {
      id: Generated<string>;
      userInfo: {
        name: string;
        age: number | null;
        bio: string | null;
        email: string;
        phone: string | null;
      };
      metadata: {
        created: Timestamp;
        lastUpdated: Timestamp | null;
        version: number;
      };
      archived: boolean | null;
      createdAt: AssertNonNull<Timestamp>;
      updatedAt: Timestamp | null;
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
      createdAt: AssertNonNull<Timestamp>;
      updatedAt: Timestamp | null;
    }

    SalesOrder: {
      id: Generated<string>;
      customerID: string;
      approvedByUserIDs: string[] | null;
      totalPrice: number | null;
      discount: number | null;
      status: string | null;
      cancelReason: string | null;
      canceledAt: Timestamp | null;
      createdAt: AssertNonNull<Timestamp>;
      updatedAt: Timestamp | null;
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
      createdAt: AssertNonNull<Timestamp>;
      updatedAt: Timestamp | null;
    }

    User: {
      id: Generated<string>;
      name: string;
      email: string;
      status: string | null;
      department: string | null;
      role: "MANAGER" | "STAFF";
      createdAt: AssertNonNull<Timestamp>;
      updatedAt: Timestamp | null;
    }

    UserSetting: {
      id: Generated<string>;
      language: "jp" | "en";
      userID: string;
      createdAt: AssertNonNull<Timestamp>;
      updatedAt: Timestamp | null;
    }
  }
}

export function getDB<const N extends keyof Namespace>(namespace: N): Kysely<Namespace[N]> {
  const client = new tailordb.Client({ namespace });
  return new Kysely<Namespace[N]>({ dialect: new TailordbDialect(client) });
}

export type DB<N extends keyof Namespace = keyof Namespace> = ReturnType<typeof getDB<N>>;
